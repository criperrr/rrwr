#!/usr/bin/env python3
"""
Master Launcher for RRWR Maestro E2E Test Suite via Android SDK Platform-Tools.

Automates:
1. Verifying environment prerequisites (adb in platform-tools, maestro CLI, emulator).
2. Connecting to an active Android device or booting the local AVD.
3. Preparing the Android environment (dismissing system dialogs, managing app state).
4. Spawning the embedded RRWR Axum backend server on an isolated port and temporary config.
5. Reversing the port via adb (`adb reverse tcp:<port> tcp:<port>`).
6. Executing Maestro declarative YAML flows with screenshot capture and validation.
7. Collecting deep performance diagnostics (dumpsys meminfo, gfxinfo, top, backend VmRSS, logcat).
8. Generating structured reports and visual artifacts.
"""

import argparse
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import List, Optional

# Relative paths
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
MAESTRO_DIR = REPO_ROOT / "tests" / "maestro_e2e"
FLOWS_DIR = MAESTRO_DIR / "flows"
SCREENSHOTS_DIR = MAESTRO_DIR / "screenshots"
LOGS_DIR = MAESTRO_DIR / "logs"
REPORTS_DIR = MAESTRO_DIR / "reports"
SERVER_BIN = REPO_ROOT / "target" / "debug" / "server"

from performance_collector import PerformanceCollector


def get_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def find_binary(bin_name: str, fallback_paths: List[str]) -> Optional[str]:
    found = shutil.which(bin_name)
    if found:
        return found
    for p in fallback_paths:
        if os.path.isfile(p) and os.access(p, os.X_OK):
            return p
    return None


def get_connected_device(adb: str) -> Optional[str]:
    try:
        res = subprocess.run([adb, "devices"], stdout=subprocess.PIPE, text=True, check=True)
        for line in res.stdout.strip().splitlines()[1:]:
            parts = line.split()
            if len(parts) >= 2 and parts[1] == "device":
                return parts[0]
    except Exception:
        pass
    return None


def boot_emulator_if_needed(adb: str, timeout: int = 150) -> str:
    dev = get_connected_device(adb)
    if dev:
        print(f"[*] Found active Android device: {dev}")
        return dev

    # Clean up stale locks if no device is connected
    avd_dir = Path.home() / ".android" / "avd"
    if avd_dir.exists():
        for lock_file in avd_dir.rglob("*.lock"):
            try:
                lock_file.unlink()
            except Exception:
                pass
    run_avd = Path(f"/run/user/{os.getuid()}/avd/running")
    if run_avd.exists():
        shutil.rmtree(run_avd, ignore_errors=True)

    emulator_bin = find_binary("emulator", [
        os.path.expanduser("~/.android/sdk/emulator/emulator"),
        os.path.expanduser("~/Android/Sdk/emulator/emulator")
    ])
    if not emulator_bin:
        raise RuntimeError("No running Android device found and 'emulator' binary was not located.")

    list_res = subprocess.run([emulator_bin, "-list-avds"], stdout=subprocess.PIPE, text=True)
    avds = [x.strip() for x in list_res.stdout.splitlines() if x.strip()]
    if not avds:
        raise RuntimeError("No AVDs found. Please create an Android Virtual Device via Android Studio.")

    chosen_avd = "medium_phone" if "medium_phone" in avds else avds[0]
    print(f"[*] Booting Android emulator with AVD '{chosen_avd}' in background...")
    subprocess.Popen(
        [emulator_bin, "-avd", chosen_avd, "-no-window", "-no-audio", "-no-boot-anim", "-no-snapshot-load", "-gpu", "swiftshader_indirect"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )

    print("[*] Waiting for device to complete boot...")
    start_time = time.time()
    while time.time() - start_time < timeout:
        dev = get_connected_device(adb)
        if dev:
            boot_status = subprocess.run(
                [adb, "-s", dev, "shell", "getprop", "sys.boot_completed"],
                stdout=subprocess.PIPE, text=True
            ).stdout.strip()
            if boot_status == "1":
                print(f"[OK] Emulator booted and online: {dev}")
                return dev
        time.sleep(3)

    raise TimeoutError(f"Emulator did not finish booting within {timeout} seconds.")


def prepare_android_environment(adb: str, device: str):
    print(f"[*] Configuring Android environment on device {device}...")
    # Dismiss any leftover system dialogs
    subprocess.run(
        [adb, "-s", device, "shell", "am", "broadcast", "-a", "android.intent.action.CLOSE_SYSTEM_DIALOGS"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    subprocess.run(
        [adb, "-s", device, "shell", "input", "keyevent", "4"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    # Ensure storage thresholds do not block APK installation
    subprocess.run(
        [adb, "-s", device, "shell", "settings", "put", "global", "sys_storage_threshold_percentage", "1"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    subprocess.run(
        [adb, "-s", device, "shell", "settings", "put", "global", "sys_storage_threshold_max_bytes", "50000000"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )


def ensure_apk_installed(adb: str, device: str) -> Path:
    apk_path = (
        REPO_ROOT
        / "src-tauri"
        / "gen"
        / "android"
        / "app"
        / "build"
        / "outputs"
        / "apk"
        / "universal"
        / "debug"
        / "app-universal-debug.apk"
    )

    outdated = False
    if not apk_path.exists():
        outdated = True
    else:
        apk_mtime = apk_path.stat().st_mtime
        for check_dir in [REPO_ROOT / "src", REPO_ROOT / "src-tauri" / "src"]:
            for p in check_dir.rglob("*"):
                if p.is_file() and p.stat().st_mtime > apk_mtime:
                    outdated = True
                    break
            if outdated:
                break

    if outdated:
        print("[*] Debug APK is missing or outdated. Running Gradle build: cd src-tauri/gen/android && ./gradlew assembleUniversalDebug...")
        android_dir = REPO_ROOT / "src-tauri" / "gen" / "android"
        res = subprocess.run(["./gradlew", "assembleUniversalDebug"], cwd=android_dir)
        if res.returncode != 0:
            print("[!] Gradle build failed.", file=sys.stderr)
            sys.exit(1)

    if not apk_path.exists():
        print(f"[!] Error: Debug APK not found at {apk_path}", file=sys.stderr)
        sys.exit(1)

    # Check if com.rrwr.app is installed
    check_installed = subprocess.run(
        [adb, "-s", device, "shell", "pm", "list", "packages", "com.rrwr.app"],
        stdout=subprocess.PIPE, text=True
    )
    is_installed = "package:com.rrwr.app" in check_installed.stdout

    if is_installed and not outdated:
        print(f"[OK] Package com.rrwr.app is already installed and up-to-date on device {device}.")
        return apk_path

    print(f"[*] Installing/updating APK on device {device} ({apk_path.name})...")
    if is_installed:
        subprocess.run([adb, "-s", device, "uninstall", "com.rrwr.app"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    install_res = subprocess.run(
        [adb, "-s", device, "install", "-r", str(apk_path)],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
    )
    if install_res.returncode != 0:
        print(f"[!] Warning during APK install: {install_res.stderr.strip() or install_res.stdout.strip()}")
    else:
        print(f"[OK] APK installed successfully on device {device}.")

    return apk_path


def ensure_server_binary():
    if not SERVER_BIN.exists():
        print("[*] Server binary not found. Compiling 'server' binary with cargo...")
        cmd = ["cargo", "build", "--bin", "server"]
        res = subprocess.run(cmd, cwd=REPO_ROOT)
        if res.returncode != 0:
            print("[!] Failed to build server binary via cargo.", file=sys.stderr)
            sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="RRWR Maestro E2E Test Suite Runner")
    parser.add_argument("--port", type=int, default=0, help="Axum server port (0 for auto)")
    parser.add_argument("--device", type=str, default="", help="Specific Android device ID")
    parser.add_argument("--flow", type=str, default="", help="Run a specific flow filename")
    args = parser.parse_args()

    # Step 1: Discover binaries
    adb_bin = find_binary("adb", [
        os.path.expanduser("~/.android/sdk/platform-tools/adb"),
        os.path.expanduser("~/Android/Sdk/platform-tools/adb")
    ])
    if not adb_bin:
        print("[!] ERROR: 'adb' from Android SDK platform-tools not found in PATH or standard locations.", file=sys.stderr)
        sys.exit(1)

    maestro_bin = find_binary("maestro", [
        os.path.expanduser("~/.maestro/bin/maestro")
    ])
    if not maestro_bin:
        print("[!] ERROR: 'maestro' CLI not found in PATH or ~/.maestro/bin/maestro.", file=sys.stderr)
        sys.exit(1)

    print(f"[OK] Using platform-tools adb: {adb_bin}")
    print(f"[OK] Using maestro CLI: {maestro_bin}")

    # Step 2: Establish Device & Install APK
    device_id = args.device.strip() or boot_emulator_if_needed(adb_bin)
    prepare_android_environment(adb_bin, device_id)
    ensure_apk_installed(adb_bin, device_id)

    # Step 3: Directories
    SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    # Step 4: Server setup
    ensure_server_binary()
    port = args.port if args.port > 0 else get_free_port()
    print(f"[*] Spawning RRWR Axum backend server on 127.0.0.1:{port}...")

    temp_config_dir = tempfile.mkdtemp(prefix="rrwr_maestro_cfg_")
    cfg_subdir = Path(temp_config_dir) / "rrwr"
    cfg_subdir.mkdir(parents=True, exist_ok=True)

    # Detect asset pack
    asset_dir = os.environ.get("RRWR_ASSET_DIR")
    if not asset_dir:
        real_cfg = Path.home() / ".config" / "rrwr" / "config.json"
        if real_cfg.exists():
            try:
                with open(real_cfg, "r", encoding="utf-8") as rf:
                    asset_dir = json.load(rf).get("assetDir")
            except Exception:
                pass
    if not asset_dir or not Path(asset_dir).exists():
        fallback = Path(__file__).resolve().parent.parent / "fixtures"
        if fallback.exists():
            asset_dir = str(fallback)

    vanilla_cfg = {
        "assetDir": asset_dir or "",
        "enabledMods": [],
        "settings": {
            "modListEnabled": []
        }
    }
    with open(cfg_subdir / "config.json", "w", encoding="utf-8") as f:
        json.dump(vanilla_cfg, f, indent=2)

    server_env = os.environ.copy()
    server_env["XDG_CONFIG_HOME"] = temp_config_dir

    server_log_path = LOGS_DIR / "server.log"
    server_log_fp = open(server_log_path, "w", encoding="utf-8")
    server_proc = subprocess.Popen(
        [str(SERVER_BIN), str(port)],
        cwd=REPO_ROOT,
        stdout=server_log_fp,
        stderr=subprocess.STDOUT,
        text=True,
        env=server_env
    )

    def cleanup(signum=None, frame=None):
        print("\n[*] Cleaning up Maestro E2E test resources...")
        try:
            subprocess.run([adb_bin, "-s", device_id, "reverse", "--remove", f"tcp:{port}"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass
        if server_proc and server_proc.poll() is None:
            server_proc.terminate()
            try:
                server_proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                server_proc.kill()
        if server_log_fp:
            try:
                server_log_fp.close()
            except Exception:
                pass
        if temp_config_dir and os.path.exists(temp_config_dir):
            shutil.rmtree(temp_config_dir, ignore_errors=True)
        if signum is not None:
            sys.exit(128 + signum)

    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)

    try:
        # Pre-flight server connection with retry loop
        import urllib.request
        connected = False
        for attempt in range(20):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=1) as resp:
                    connected = True
                    break
            except Exception:
                time.sleep(0.5)
        if not connected:
            raise RuntimeError(f"RRWR backend server failed to start on 127.0.0.1:{port} within 10 seconds.")
        print(f"[OK] Backend server listening at http://127.0.0.1:{port}")

        # Reverse port via adb
        rev_res = subprocess.run(
            [adb_bin, "-s", device_id, "reverse", f"tcp:{port}", f"tcp:{port}"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True
        )
        print(f"[OK] Reversed port {port} on device via adb (status: {rev_res.stdout.strip()})")

        # Step 5: Gather flows to run
        if args.flow:
            flow_files = [FLOWS_DIR / args.flow]
        else:
            flow_files = sorted(FLOWS_DIR.glob("*.yaml"))

        if not flow_files:
            print("[!] No flow files found in tests/maestro_e2e/flows/", file=sys.stderr)
            sys.exit(1)

        print(f"[*] Executing {len(flow_files)} Maestro flow(s) against device {device_id}...")
        test_results = []
        target_url = f"http://localhost:{port}"

        for flow in flow_files:
            flow_name = flow.stem
            print(f"\n--- Running Flow: {flow_name} ---")
            flow_output_dir = LOGS_DIR / "maestro_artifacts" / flow_name
            flow_output_dir.mkdir(parents=True, exist_ok=True)

            # Ensure clean state before each flow to prevent singleTask activity state bleed
            subprocess.run(
                [adb_bin, "-s", device_id, "shell", "am", "force-stop", "com.rrwr.app"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            # Ensure config.json points to Asset Pack V2 and clean tabs
            subprocess.run(
                [adb_bin, "-s", device_id, "shell", "run-as com.rrwr.app dd of=files/config.json"],
                input='{"assetDir":"/data/user/0/com.rrwr.app/files/Asset Pack V2","enabledMods":[],"settings":{"modListEnabled":[]}}\n',
                text=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            time.sleep(0.5)

            cmd = [
                maestro_bin,
                "test",
                str(flow),
                "--device", device_id,
                "--test-output-dir", str(flow_output_dir),
                "-e", f"TARGET_URL={target_url}"
            ]

            start_t = time.time()
            res = subprocess.run(cmd, text=True)
            duration_s = round(time.time() - start_t, 2)
            passed = (res.returncode == 0)

            # Copy screenshots into tests/maestro_e2e/screenshots/
            for sc in sorted(flow_output_dir.rglob("*.png"), key=lambda p: p.stat().st_mtime):
                if sc.stat().st_mtime >= start_t - 5:
                    dest = SCREENSHOTS_DIR / sc.name
                    shutil.copy2(sc, dest)
                    print(f"  [+] Saved screenshot: {dest.relative_to(REPO_ROOT)}")

            test_results.append({
                "flow": flow_name,
                "passed": passed,
                "duration_seconds": duration_s
            })

            status_str = "[PASS]" if passed else "[FAIL]"
            print(f"Result {status_str} in {duration_s}s")

        # Step 6: Collect Performance & Diagnostics
        print("\n[*] Collecting comprehensive performance diagnostics...")
        perf_collector = PerformanceCollector(
            adb_path=adb_bin,
            device_id=device_id,
            package_name="com.rrwr.app",
            output_dir=MAESTRO_DIR,
            server_pid=server_proc.pid
        )
        audit_report = perf_collector.run_full_audit()

        # Step 7: Summary Report
        summary_data = {
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "device": audit_report["device"],
            "test_results": test_results,
            "backend_rss_mb": audit_report["backend_server_memory"].get("vm_rss_mb"),
            "backend_sla_passed": audit_report["backend_server_memory"].get("sla_150mb_passed"),
            "all_passed": all(r["passed"] for r in test_results)
        }
        with open(REPORTS_DIR / "summary.json", "w", encoding="utf-8") as sf:
            json.dump(summary_data, sf, indent=2)

        # Print ASCII Summary Table
        print("\n" + "=" * 65)
        print("           MAESTRO E2E TEST & PERFORMANCE SUMMARY")
        print("=" * 65)
        print(f"Device: {audit_report['device']['model']} (Android {audit_report['device']['android_version']})")
        print(f"Backend RSS: {summary_data['backend_rss_mb']} MB (SLA < 150MB: {'PASS' if summary_data['backend_sla_passed'] else 'FAIL'})")
        print("-" * 65)
        print(f"{'Flow Name':<35} | {'Status':<10} | {'Duration':<10}")
        print("-" * 65)
        for r in test_results:
            st = "PASS" if r["passed"] else "FAIL"
            print(f"{r['flow']:<35} | {st:<10} | {r['duration_seconds']}s")
        print("=" * 65)

        if not summary_data["all_passed"]:
            print("[!] One or more Maestro flows failed.", file=sys.stderr)
            sys.exit(1)
        else:
            print("[OK] All Maestro flows passed with real device execution!")

    finally:
        cleanup()


if __name__ == "__main__":
    main()
