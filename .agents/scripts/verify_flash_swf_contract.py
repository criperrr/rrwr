#!/usr/bin/env python3
"""
Targeted Verification Script: Flash SWF & Ruffle WASM Loading Contract
Verifies that the Axum loopback server strictly conforms to:
1. Exact MIME types for Flash (application/x-shockwave-flash), WASM (application/wasm), and JS (application/javascript).
2. HTTP 206 Partial Content Range streaming (prefix, suffix, mid-range) and boundary error handling (416).
3. Delivery of canonical Ruffle player assets and target story Flash files:
   - /assets/archive/imods/_ruffle_bundle/js/ruffle/ruffle.js
   - /assets/archive/imods/_ruffle_bundle/js/ruffle/core.ruffle.*.wasm
   - /assets/storyfiles/comic1/scene1/scene1.swf (Page 000001)
   - /assets/storyfiles/comic1/scene2/scene2.swf (Page 000002)
   - /assets/storyfiles/comic1/scene3/scene3.swf (Page 000003)
4. Memory RSS constraint strictly < 150MB SLA throughout Flash/WASM asset streaming.
"""

import os
import sys
import time
import subprocess
import urllib.request
import urllib.error

try:
    import psutil
except ImportError:
    psutil = None

MEMORY_CEILING_MB = 150.0
MIN_SANITY_RSS_MB = 5.0

def find_server_binary():
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    release_bin = os.path.join(base_dir, "target", "release", "server")
    debug_bin = os.path.join(base_dir, "target", "debug", "server")
    if os.path.isfile(release_bin) and os.access(release_bin, os.X_OK):
        return release_bin, base_dir
    if os.path.isfile(debug_bin) and os.access(debug_bin, os.X_OK):
        return debug_bin, base_dir
    raise FileNotFoundError("Backend server binary not found. Run cargo build --bin server first.")

def get_process_rss_mb(pid):
    if psutil:
        try:
            return psutil.Process(pid).memory_info().rss / (1024 * 1024)
        except Exception:
            pass
    status_file = f"/proc/{pid}/status"
    if os.path.exists(status_file):
        try:
            with open(status_file, "r") as f:
                for line in f:
                    if line.startswith("VmRSS:"):
                        parts = line.split()
                        return float(parts[1]) / 1024.0
        except Exception:
            pass
    return 0.0

def resolve_asset_pack_dir():
    candidate = os.environ.get("RRWR_ASSET_DIR", "/home/criper/Downloads/Asset Pack V2")
    if os.path.isdir(candidate):
        return candidate
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    fixture_candidate = os.path.join(base_dir, "tests", "fixtures")
    if os.path.isdir(fixture_candidate):
        return fixture_candidate
    raise FileNotFoundError("Could not locate Asset Pack V2 directory or test fixtures.")

def resolve_authoritative_disk_file(asset_pack, rel_path):
    """
    Resolves the expected file taking into account VFS layered resolution order:
    1. Active mod overlay (e.g. localized mod under mods/example-ptbr/Assets/)
    2. Base asset pack directory
    """
    mod_candidate = os.path.join(asset_pack, "mods", "example-ptbr", "Assets", rel_path)
    if os.path.isfile(mod_candidate):
        return mod_candidate
    base_candidate = os.path.join(asset_pack, rel_path)
    if os.path.isfile(base_candidate):
        return base_candidate
    return None

def test_request(url, headers=None, method="GET"):
    req = urllib.request.Request(url, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = resp.read()
            return resp.status, resp.headers, data
    except urllib.error.HTTPError as e:
        data = e.read()
        return e.code, e.headers, data

def main():
    print("=" * 70)
    print("  RRWR Flash SWF & Ruffle WASM Loading Contract Verification")
    print("=" * 70)

    asset_pack = resolve_asset_pack_dir()
    print(f"[*] Asset Pack Root: {asset_pack}")

    server_bin, base_dir = find_server_binary()
    print(f"[*] Server Binary: {server_bin}")

    proc = subprocess.Popen(
        [server_bin, "0"],
        cwd=base_dir,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    port = None
    try:
        start_time = time.time()
        while time.time() - start_time < 10:
            line = proc.stdout.readline()
            if not line:
                if proc.poll() is not None:
                    break
                time.sleep(0.05)
                continue
            line_str = line.strip()
            print(f"    {line_str}")
            if "listening on http://127.0.0.1:" in line_str:
                port = int(line_str.split(":")[-1].strip())
                break

        if not port:
            _, stderr = proc.communicate(timeout=2)
            print(f"[-] Failed to bind server. Stderr: {stderr}")
            sys.exit(1)

        base_url = f"http://127.0.0.1:{port}"
        print(f"[*] Axum Loopback URL: {base_url}")
        time.sleep(0.5)

        initial_rss = get_process_rss_mb(proc.pid)
        print(f"[*] Initial Server RSS: {initial_rss:.2f} MB")
        if initial_rss > MEMORY_CEILING_MB:
            print(f"[-] Initial RSS strictly exceeded {MEMORY_CEILING_MB} MB limit.")
            sys.exit(1)

        # Target asset test matrix
        target_assets = [
            {
                "rel_path": "archive/imods/_ruffle_bundle/js/ruffle/ruffle.js",
                "uri": "/assets/archive/imods/_ruffle_bundle/js/ruffle/ruffle.js",
                "expected_mime": "application/javascript",
                "label": "Ruffle Player Main Bundle",
            },
            {
                "rel_path": "archive/imods/_ruffle_bundle/js/ruffle/core.ruffle.cc1aa67dae49c28fd82f.wasm",
                "uri": "/assets/archive/imods/_ruffle_bundle/js/ruffle/core.ruffle.cc1aa67dae49c28fd82f.wasm",
                "expected_mime": "application/wasm",
                "label": "Ruffle Core WASM Binary (core.ruffle.cc1aa67dae49c28fd82f.wasm)",
            },
            {
                "rel_path": "archive/imods/_ruffle_bundle/js/ruffle/core.ruffle.2225ca69a4594bf6772e.wasm",
                "uri": "/assets/archive/imods/_ruffle_bundle/js/ruffle/core.ruffle.2225ca69a4594bf6772e.wasm",
                "expected_mime": "application/wasm",
                "label": "Ruffle Core WASM Binary (core.ruffle.2225ca69a4594bf6772e.wasm)",
            },
            {
                "rel_path": "archive/imods/_ruffle_bundle/js/ruffle/e6c08a4d57d1c54d19e9.wasm",
                "uri": "/assets/archive/imods/_ruffle_bundle/js/ruffle/e6c08a4d57d1c54d19e9.wasm",
                "expected_mime": "application/wasm",
                "label": "Ruffle Webpack WASM Chunk",
            },
            {
                "rel_path": "storyfiles/comic1/scene1/scene1.swf",
                "uri": "/assets/storyfiles/comic1/scene1/scene1.swf",
                "expected_mime": "application/x-shockwave-flash",
                "label": "Flash scene1.swf (Page 000001: [S] Check Dialog Log)",
            },
            {
                "rel_path": "storyfiles/comic1/scene2/scene2.swf",
                "uri": "/assets/storyfiles/comic1/scene2/scene2.swf",
                "expected_mime": "application/x-shockwave-flash",
                "label": "Flash scene2.swf (Page 000002: [S] Animated Scene)",
            },
            {
                "rel_path": "storyfiles/comic1/scene3/scene3.swf",
                "uri": "/assets/storyfiles/comic1/scene3/scene3.swf",
                "expected_mime": "application/x-shockwave-flash",
                "label": "Flash scene3.swf (Page 000003: [S] Chapter 1)",
            },
        ]

        total_checks = 0
        passed_checks = 0

        for item in target_assets:
            rel = item["rel_path"]
            uri = item["uri"]
            expected_mime = item["expected_mime"]
            label = item["label"]
            file_on_disk = resolve_authoritative_disk_file(asset_pack, rel)

            print(f"\n[*] Testing Contract: {label}")
            print(f"    URI: {uri}")

            if not file_on_disk or not os.path.exists(file_on_disk):
                print(f"[-] Authoritative disk file not found for: {rel}")
                sys.exit(1)

            disk_size = os.path.getsize(file_on_disk)
            print(f"    Resolved Path: {file_on_disk}")
            print(f"    Disk Size: {disk_size} bytes")

            # 1. Full GET Verification
            total_checks += 1
            status, headers, body = test_request(f"{base_url}{uri}")
            if status != 200:
                print(f"[-] Full GET failed: expected status 200, got {status}")
                sys.exit(1)
            content_type = headers.get("Content-Type", "")
            if expected_mime not in content_type:
                print(f"[-] Content-Type mismatch: expected '{expected_mime}', got '{content_type}'")
                sys.exit(1)
            if len(body) != disk_size:
                print(f"[-] Body length mismatch: expected {disk_size}, got {len(body)}")
                sys.exit(1)
            cors_origin = headers.get("Access-Control-Allow-Origin", "")
            if cors_origin != "*":
                print(f"[-] CORS header missing or incorrect: got '{cors_origin}'")
                sys.exit(1)
            with open(file_on_disk, "rb") as f:
                disk_first_bytes = f.read(512)
            if body[:512] != disk_first_bytes:
                print("[-] Full GET content prefix mismatch with disk file")
                sys.exit(1)
            passed_checks += 1
            print(f"    [OK] Full GET: 200 OK, Content-Type: {content_type}, Size: {len(body)} bytes")

            # 2. Prefix Range Request (bytes=0-1023)
            range_len = min(1024, disk_size)
            req_end = range_len - 1
            total_checks += 1
            status, headers, body = test_request(
                f"{base_url}{uri}",
                headers={"Range": f"bytes=0-{req_end}"}
            )
            if status != 206:
                print(f"[-] Prefix Range failed: expected status 206, got {status}")
                sys.exit(1)
            expected_cr = f"bytes 0-{req_end}/{disk_size}"
            actual_cr = headers.get("Content-Range", "")
            if actual_cr != expected_cr:
                print(f"[-] Content-Range mismatch: expected '{expected_cr}', got '{actual_cr}'")
                sys.exit(1)
            if len(body) != range_len:
                print(f"[-] Prefix range body length mismatch: expected {range_len}, got {len(body)}")
                sys.exit(1)
            with open(file_on_disk, "rb") as f:
                expected_bytes = f.read(range_len)
            if body != expected_bytes:
                print("[-] Prefix range data content mismatch with disk slice")
                sys.exit(1)
            passed_checks += 1
            print(f"    [OK] Range (bytes=0-{req_end}): 206 Partial Content, Content-Range: {actual_cr}")

            # 3. Suffix Range Request (bytes=-512)
            suffix_len = min(512, disk_size)
            total_checks += 1
            status, headers, body = test_request(
                f"{base_url}{uri}",
                headers={"Range": f"bytes=-{suffix_len}"}
            )
            if status != 206:
                print(f"[-] Suffix Range failed: expected status 206, got {status}")
                sys.exit(1)
            suffix_start = disk_size - suffix_len
            suffix_end = disk_size - 1
            expected_cr = f"bytes {suffix_start}-{suffix_end}/{disk_size}"
            actual_cr = headers.get("Content-Range", "")
            if actual_cr != expected_cr:
                print(f"[-] Suffix Content-Range mismatch: expected '{expected_cr}', got '{actual_cr}'")
                sys.exit(1)
            if len(body) != suffix_len:
                print(f"[-] Suffix body length mismatch: expected {suffix_len}, got {len(body)}")
                sys.exit(1)
            with open(file_on_disk, "rb") as f:
                f.seek(suffix_start)
                expected_bytes = f.read(suffix_len)
            if body != expected_bytes:
                print("[-] Suffix range data content mismatch with disk slice")
                sys.exit(1)
            passed_checks += 1
            print(f"    [OK] Range (bytes=-{suffix_len}): 206 Partial Content, Content-Range: {actual_cr}")

            # 4. Mid-Range Request (bytes=1000-2999) if file is large enough
            if disk_size > 4000:
                mid_start = 1000
                mid_end = 2999
                mid_len = mid_end - mid_start + 1
                total_checks += 1
                status, headers, body = test_request(
                    f"{base_url}{uri}",
                    headers={"Range": f"bytes={mid_start}-{mid_end}"}
                )
                if status != 206:
                    print(f"[-] Mid Range failed: expected status 206, got {status}")
                    sys.exit(1)
                expected_cr = f"bytes {mid_start}-{mid_end}/{disk_size}"
                actual_cr = headers.get("Content-Range", "")
                if actual_cr != expected_cr:
                    print(f"[-] Mid Content-Range mismatch: expected '{expected_cr}', got '{actual_cr}'")
                    sys.exit(1)
                if len(body) != mid_len:
                    print(f"[-] Mid body length mismatch: expected {mid_len}, got {len(body)}")
                    sys.exit(1)
                with open(file_on_disk, "rb") as f:
                    f.seek(mid_start)
                    expected_bytes = f.read(mid_len)
                if body != expected_bytes:
                    print("[-] Mid range data content mismatch with disk slice")
                    sys.exit(1)
                passed_checks += 1
                print(f"    [OK] Range (bytes={mid_start}-{mid_end}): 206 Partial Content, Content-Range: {actual_cr}")

        # Boundary / Invalid Range checks
        print("\n[*] Testing Boundary & Error Contracts:")
        test_uri = "/assets/storyfiles/comic1/scene3/scene3.swf"
        file_disk = resolve_authoritative_disk_file(asset_pack, "storyfiles/comic1/scene3/scene3.swf")
        file_size = os.path.getsize(file_disk)

        # Saturated / Out of bounds range
        total_checks += 1
        status, headers, _ = test_request(
            f"{base_url}{test_uri}",
            headers={"Range": "bytes=99999999-999999999"}
        )
        if status != 416:
            print(f"[-] Out-of-bounds range failed: expected status 416, got {status}")
            sys.exit(1)
        cr = headers.get("Content-Range", "")
        if f"bytes */{file_size}" not in cr:
            print(f"[-] 416 Content-Range mismatch: expected 'bytes */{file_size}', got '{cr}'")
            sys.exit(1)
        passed_checks += 1
        print(f"    [OK] Out-of-bounds Range: 416 Range Not Satisfiable, Content-Range: {cr}")

        # Inverted range
        total_checks += 1
        status, _, _ = test_request(
            f"{base_url}{test_uri}",
            headers={"Range": "bytes=5000-2000"}
        )
        if status != 416:
            print(f"[-] Inverted range failed: expected status 416, got {status}")
            sys.exit(1)
        passed_checks += 1
        print("    [OK] Inverted Range: 416 Range Not Satisfiable")

        # Memory RSS Verification after serving all assets
        current_rss = get_process_rss_mb(proc.pid)
        print("\n[*] Memory Footprint Audit:")
        print(f"    Measured Server RSS: {current_rss:.2f} MB")
        print(f"    Memory SLA Ceiling:  {MEMORY_CEILING_MB:.2f} MB")

        if current_rss <= 0.0 or current_rss < MIN_SANITY_RSS_MB:
            print(f"[-] Unmeasurable or invalid memory reading: {current_rss:.2f} MB")
            sys.exit(1)

        if current_rss > MEMORY_CEILING_MB:
            print(f"[-] Server memory strictly exceeded SLA: {current_rss:.2f} MB > {MEMORY_CEILING_MB} MB")
            sys.exit(1)

        headroom = MEMORY_CEILING_MB - current_rss
        print(f"    [OK] Memory strictly within SLA (Headroom: {headroom:.2f} MB)")

        print("\n" + "=" * 70)
        print(f"  FLASH SWF & RUFFLE WASM VERIFICATION PASSED: {passed_checks}/{total_checks} checks OK")
        print("=" * 70)
        sys.exit(0)

    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()

if __name__ == "__main__":
    main()
