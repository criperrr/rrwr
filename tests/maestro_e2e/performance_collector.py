#!/usr/bin/env python3
"""
Performance & Diagnostics Collector for RRWR Maestro E2E Suite.

Collects and parses:
1. Android OS & Device Metadata (model, Android version, screen size).
2. Android Memory Allocation (dumpsys meminfo: PSS, RSS, Java/Native Heap, Graphics).
3. Android Rendering & Frame Latencies (dumpsys gfxinfo: frame times, jank percentage, percentiles).
4. CPU Utilization (adb top snapshot).
5. RRWR Backend Memory Footprint (VmRSS, VmHWM, <150MB RSS SLA compliance).
6. Android Logcat dump for diagnostic debugging.
"""

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any, Dict, Optional


class PerformanceCollector:
    def __init__(self, adb_path: str, device_id: str, package_name: str, output_dir: Path, server_pid: Optional[int] = None):
        self.adb = adb_path
        self.device = device_id
        self.package = package_name
        self.output_dir = output_dir
        self.server_pid = server_pid
        self.logs_dir = output_dir / "logs"
        self.reports_dir = output_dir / "reports"
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        self.reports_dir.mkdir(parents=True, exist_ok=True)

    def _adb_cmd(self, args: list, timeout: int = 10) -> str:
        cmd = [self.adb, "-s", self.device] + args
        try:
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=timeout)
            return res.stdout.strip()
        except Exception as e:
            return f"ERROR: {e}"

    def collect_device_info(self) -> Dict[str, str]:
        model = self._adb_cmd(["shell", "getprop", "ro.product.model"])
        release = self._adb_cmd(["shell", "getprop", "ro.build.version.release"])
        sdk = self._adb_cmd(["shell", "getprop", "ro.build.version.sdk"])
        wm_size = self._adb_cmd(["shell", "wm", "size"])
        abi = self._adb_cmd(["shell", "getprop", "ro.product.cpu.abi"])
        return {
            "device_id": self.device,
            "model": model,
            "android_version": release,
            "sdk_level": sdk,
            "screen_size": wm_size.replace("Physical size: ", ""),
            "cpu_abi": abi
        }

    def collect_meminfo(self) -> Dict[str, Any]:
        raw = self._adb_cmd(["shell", "dumpsys", "meminfo", self.package])
        (self.logs_dir / "meminfo_raw.txt").write_text(raw, encoding="utf-8")

        metrics: Dict[str, Any] = {
            "total_pss_kb": 0,
            "total_rss_kb": 0,
            "private_dirty_kb": 0,
            "private_clean_kb": 0,
            "java_heap_pss_kb": 0,
            "native_heap_pss_kb": 0,
            "code_pss_kb": 0,
            "graphics_pss_kb": 0
        }

        # Parse App Summary section
        summary_m = re.search(r"App Summary\s+Pss\(KB\)\s+Rss\(KB\)\s+-+\s+-+\s+Java Heap:\s+(\d+)\s+(\d+)", raw)
        if summary_m:
            metrics["java_heap_pss_kb"] = int(summary_m.group(1))

        native_m = re.search(r"Native Heap:\s+(\d+)\s+(\d+)", raw)
        if native_m:
            metrics["native_heap_pss_kb"] = int(native_m.group(1))

        code_m = re.search(r"Code:\s+(\d+)\s+(\d+)", raw)
        if code_m:
            metrics["code_pss_kb"] = int(code_m.group(1))

        gfx_m = re.search(r"Graphics:\s+(\d+)\s+(\d+)", raw)
        if gfx_m:
            metrics["graphics_pss_kb"] = int(gfx_m.group(1))

        total_m = re.search(r"TOTAL PSS:\s+(\d+)\s+TOTAL RSS:\s+(\d+)", raw)
        if total_m:
            metrics["total_pss_kb"] = int(total_m.group(1))
            metrics["total_rss_kb"] = int(total_m.group(2))
        else:
            # Fallback to TOTAL line in table
            tbl_total = re.search(r"TOTAL\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)", raw)
            if tbl_total:
                metrics["total_pss_kb"] = int(tbl_total.group(1))
                metrics["private_dirty_kb"] = int(tbl_total.group(2))
                metrics["private_clean_kb"] = int(tbl_total.group(3))
                metrics["total_rss_kb"] = int(tbl_total.group(5))

        metrics["total_pss_mb"] = round(metrics["total_pss_kb"] / 1024, 2)
        metrics["total_rss_mb"] = round(metrics["total_rss_kb"] / 1024, 2)
        return metrics

    def collect_gfxinfo(self) -> Dict[str, Any]:
        raw = self._adb_cmd(["shell", "dumpsys", "gfxinfo", self.package])
        (self.logs_dir / "gfxinfo_raw.txt").write_text(raw, encoding="utf-8")

        metrics: Dict[str, Any] = {
            "total_frames_rendered": 0,
            "janky_frames": 0,
            "janky_percent": 0.0,
            "percentile_50th_ms": 0,
            "percentile_90th_ms": 0,
            "percentile_95th_ms": 0,
            "percentile_99th_ms": 0,
            "missed_vsync": 0,
            "slow_ui_thread": 0
        }

        frames_m = re.search(r"Total frames rendered:\s+(\d+)", raw)
        if frames_m:
            metrics["total_frames_rendered"] = int(frames_m.group(1))

        jank_m = re.search(r"Janky frames:\s+(\d+)\s+\(([\d.]+)%\)", raw)
        if jank_m:
            metrics["janky_frames"] = int(jank_m.group(1))
            metrics["janky_percent"] = float(jank_m.group(2))

        p50 = re.search(r"50th percentile:\s+(\d+)ms", raw)
        if p50:
            metrics["percentile_50th_ms"] = int(p50.group(1))

        p90 = re.search(r"90th percentile:\s+(\d+)ms", raw)
        if p90:
            metrics["percentile_90th_ms"] = int(p90.group(1))

        p95 = re.search(r"95th percentile:\s+(\d+)ms", raw)
        if p95:
            metrics["percentile_95th_ms"] = int(p95.group(1))

        p99 = re.search(r"99th percentile:\s+(\d+)ms", raw)
        if p99:
            metrics["percentile_99th_ms"] = int(p99.group(1))

        vsync = re.search(r"Number Missed Vsync:\s+(\d+)", raw)
        if vsync:
            metrics["missed_vsync"] = int(vsync.group(1))

        slow_ui = re.search(r"Number Slow UI thread:\s+(\d+)", raw)
        if slow_ui:
            metrics["slow_ui_thread"] = int(slow_ui.group(1))

        return metrics

    def collect_cpu_top(self) -> Dict[str, Any]:
        raw = self._adb_cmd(["shell", "top", "-b", "-n", "1"])
        (self.logs_dir / "top_raw.txt").write_text(raw, encoding="utf-8")

        proc_lines = []
        for line in raw.splitlines():
            if self.package in line or "server" in line:
                proc_lines.append(line.strip())

        return {
            "monitored_processes": proc_lines
        }

    def collect_backend_memory(self) -> Dict[str, Any]:
        res = {
            "server_pid": self.server_pid,
            "vm_rss_kb": 0,
            "vm_rss_mb": 0.0,
            "vm_hwm_kb": 0,
            "vm_hwm_mb": 0.0,
            "vm_size_kb": 0,
            "sla_150mb_passed": True
        }
        if not self.server_pid:
            return res

        status_file = Path(f"/proc/{self.server_pid}/status")
        if status_file.exists():
            try:
                content = status_file.read_text(encoding="utf-8")
                rss_m = re.search(r"VmRSS:\s+(\d+)\s+kB", content)
                hwm_m = re.search(r"VmHWM:\s+(\d+)\s+kB", content)
                size_m = re.search(r"VmSize:\s+(\d+)\s+kB", content)

                if rss_m:
                    res["vm_rss_kb"] = int(rss_m.group(1))
                    res["vm_rss_mb"] = round(res["vm_rss_kb"] / 1024, 2)
                if hwm_m:
                    res["vm_hwm_kb"] = int(hwm_m.group(1))
                    res["vm_hwm_mb"] = round(res["vm_hwm_kb"] / 1024, 2)
                if size_m:
                    res["vm_size_kb"] = int(size_m.group(1))

                res["sla_150mb_passed"] = res["vm_rss_mb"] < 150.0
            except Exception as e:
                res["error"] = str(e)

        return res

    def dump_logcat(self):
        logcat = self._adb_cmd(["logcat", "-d", "-v", "time"])
        (self.logs_dir / "adb_logcat.log").write_text(logcat, encoding="utf-8")

    def run_full_audit(self) -> Dict[str, Any]:
        device_info = self.collect_device_info()
        meminfo = self.collect_meminfo()
        gfxinfo = self.collect_gfxinfo()
        cpu_info = self.collect_cpu_top()
        backend_mem = self.collect_backend_memory()
        self.dump_logcat()

        report = {
            "device": device_info,
            "browser_memory": meminfo,
            "graphics_performance": gfxinfo,
            "cpu_snapshot": cpu_info,
            "backend_server_memory": backend_mem
        }

        # Write structured JSON
        json_path = self.reports_dir / "performance_report.json"
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)

        # Write Markdown Summary
        self.write_markdown_summary(report)
        return report

    def write_markdown_summary(self, report: Dict[str, Any]):
        dev = report["device"]
        mem = report["browser_memory"]
        gfx = report["graphics_performance"]
        bk = report["backend_server_memory"]

        md = f"""# Maestro E2E Performance & Diagnostics Audit

## 1. Environment & Device
- **Device ID:** `{dev.get('device_id')}`
- **Model:** `{dev.get('model')}` (Android {dev.get('android_version')}, SDK {dev.get('sdk_level')})
- **Screen Resolution:** `{dev.get('screen_size')}`
- **CPU Architecture:** `{dev.get('cpu_abi')}`

---

## 2. RRWR Backend Memory SLA (< 150 MB RSS)
| Metric | Value | Limit / SLA | Status |
|---|---|---|---|
| **Backend VmRSS** | `{bk.get('vm_rss_mb')} MB` | `< 150.0 MB` | **{'PASS' if bk.get('sla_150mb_passed') else 'FAIL'}** |
| **Backend Peak VmHWM** | `{bk.get('vm_hwm_mb')} MB` | `< 150.0 MB` | **{'PASS' if bk.get('vm_hwm_mb', 0) < 150.0 else 'FAIL'}** |
| **Server PID** | `{bk.get('server_pid')}` | - | Monitored |

---

## 3. Browser Process Memory Footprint
| Memory Section | PSS (MB) | Details |
|---|---|---|
| **Total PSS** | `{mem.get('total_pss_mb')} MB` | Resident Set Size: `{mem.get('total_rss_mb')} MB` |
| **Java Heap** | `{round(mem.get('java_heap_pss_kb', 0) / 1024, 2)} MB` | Android Runtime allocation |
| **Native Heap** | `{round(mem.get('native_heap_pss_kb', 0) / 1024, 2)} MB` | Blink & V8 native buffers |
| **Code (mmap)** | `{round(mem.get('code_pss_kb', 0) / 1024, 2)} MB` | APK and native library mappings |
| **Graphics** | `{round(mem.get('graphics_pss_kb', 0) / 1024, 2)} MB` | GPU driver and surface cache |

---

## 4. Graphics & Rendering Latencies
| Rendering Metric | Measurement |
|---|---|
| **Total Frames Rendered** | `{gfx.get('total_frames_rendered')}` |
| **Janky Frames** | `{gfx.get('janky_frames')} ({gfx.get('janky_percent')}%)` |
| **50th Percentile Frame Time** | `{gfx.get('percentile_50th_ms')} ms` |
| **90th Percentile Frame Time** | `{gfx.get('percentile_90th_ms')} ms` |
| **95th Percentile Frame Time** | `{gfx.get('percentile_95th_ms')} ms` |
| **Missed Vsync Intervals** | `{gfx.get('missed_vsync')}` |
| **Slow UI Thread Events** | `{gfx.get('slow_ui_thread')}` |

---

## 5. Diagnostic Artifacts
- **Raw Meminfo:** `logs/meminfo_raw.txt`
- **Raw Gfxinfo:** `logs/gfxinfo_raw.txt`
- **CPU Top Snapshot:** `logs/top_raw.txt`
- **Full ADB Logcat:** `logs/adb_logcat.log`
- **Full JSON Report:** `reports/performance_report.json`
"""
        (self.reports_dir / "performance_summary.md").write_text(md, encoding="utf-8")
