# Maestro E2E Test Suite (Android Platform-Tools & Native App Integration)

Automated end-to-end integration and performance testing for Retro Reader with Ruffle (RRWR-rust) using **Maestro** and the **Android SDK Platform-Tools** (`adb`), targeting the native Android application package (`com.rrwr.app`).

---

## 1. Architectural Overview

This test suite executes real-world integration flows against the authentic RRWR native application (`com.rrwr.app`) running inside an Android environment (emulators or physical devices) connected via `adb`.

```
+--------------------------------+       adb reverse tcp       +--------------------------------+
|   Host Machine (RRWR Backend)  |<----------------------------|   Android Device / Emulator    |
|   - Embedded Axum Loopback     |                             |   - com.rrwr.app (Native APK)  |
|   - Layered VFS & ArchiveStore |---------------------------->|   - Android WebView Runtime    |
|   - Isolated Config & Assets   |        HTTP Loopback        |   - Views: Home, Story, Music  |
+--------------------------------+                             +--------------------------------+
                 ^                                                              ^
                 |                                                              |
                 |                +---------------------------+                 |
                 +----------------|    Maestro E2E Runner     |-----------------+
                                  |   (tests/maestro_e2e/)    |
                                  |   - Flow Execution        |
                                  |   - Screenshot Extraction |
                                  |   - Performance Audit     |
                                  +---------------------------+
```

### Key Capabilities
1. **Native App Targeting:** Direct UI automation of `com.rrwr.app` via declarative Maestro flows with automatic APK build/install verification.
2. **Clean State Isolation:** Enforces cold-state resetting (`am force-stop com.rrwr.app`) before every flow to eliminate singleTask activity state bleed.
3. **Zero-Configuration Port Reversal:** Automatically maps the ephemeral host server port into Android loopback (`adb reverse tcp:<port> tcp:<port>`).
4. **Automated Visual Snapshots:** Saves full-resolution screenshots directly into `tests/maestro_e2e/screenshots/` (e.g. `01_route_homepage.png`, `02_route_story_000001.png`, `03_route_music.png`, `04_route_settings.png`).
5. **Deep Performance Auditing:** Captures `dumpsys meminfo` (PSS, RSS, Java/Native Heap), `dumpsys gfxinfo` (frame latencies, janky frames, percentiles), `adb top` CPU snapshots, and backend memory RSS (< 150MB SLA).
6. **Logcat & Server Logging:** Dumps live Android system logcat and Axum server logs into `tests/maestro_e2e/logs/`.

---

## 2. Directory Layout

```
tests/maestro_e2e/
├── flows/
│   ├── 01_homepage_comprehensive.yaml         # Cold launches com.rrwr.app, asserts homepage cards, captures 01_route_homepage.png
│   ├── 02_story_reader_comprehensive.yaml     # Navigates to Story Act 1 (000001), verifies reader, captures 02_route_story_000001.png
│   ├── 03_classic_collections.yaml            # Traverses classic stories in the collection
│   ├── 04_maps_and_logs.yaml                  # Tests story adventure log and map navigation views
│   ├── 05_music_and_jukebox.yaml              # Navigates to Music section, validates discography, captures 03_route_music.png
│   ├── 06_settings_and_mods.yaml              # Opens Settings & Preferences, validates controls, captures 04_route_settings.png
│   └── 07_system_and_extras.yaml              # Tests news archive, credits, and system info dialogs
├── runner.py                                  # Master test runner, emulator orchestrator, and flow executor
├── performance_collector.py                   # Performance auditor (meminfo, gfxinfo, top, backend VmRSS)
├── README.md                                  # Architecture and documentation
├── screenshots/                               # Generated visual proof PNGs
├── logs/                                      # adb_logcat.log, server.log, maestro_artifacts/, meminfo_raw.txt, gfxinfo_raw.txt
└── reports/                                   # summary.json, performance_report.json, performance_summary.md
```

---

## 3. Prerequisites

- **Python 3.8+**
- **Android SDK Platform-Tools:** `adb` must be in `$PATH` or located at `~/.android/sdk/platform-tools/adb`.
- **Maestro CLI:** `maestro` must be in `$PATH` or located at `~/.maestro/bin/maestro`.
- **Android Device or Emulator:** An active Android device or an AVD configured in Android Studio (defaults to `medium_phone`).

---

## 4. Running the Tests

Execute the unified runner from the project root:

```bash
python3 tests/maestro_e2e/runner.py
```

### Advanced Options

- **Target a specific flow:**
  ```bash
  python3 tests/maestro_e2e/runner.py --flow 01_homepage_comprehensive.yaml
  ```
- **Specify a custom port:**
  ```bash
  python3 tests/maestro_e2e/runner.py --port 8090
  ```
- **Target a specific Android device:**
  ```bash
  python3 tests/maestro_e2e/runner.py --device emulator-5554
  ```

---

## 5. Output Artifacts & Verification

After test execution, the following files are produced:
- `tests/maestro_e2e/screenshots/`: Visual screenshots taken by Maestro during flows.
  - `01_route_homepage.png` (Route `/`)
  - `02_route_story_000001.png` (Route `/story/000001`)
  - `03_route_music.png` (Route `/music`)
  - `04_route_settings.png` (Route `/settings`)
- `tests/maestro_e2e/reports/performance_summary.md`: Human-readable performance tables.
- `tests/maestro_e2e/reports/performance_report.json`: Detailed JSON telemetry.
- `tests/maestro_e2e/reports/summary.json`: Test suite execution status and pass/fail metrics.
- `tests/maestro_e2e/logs/adb_logcat.log`: Android system logs recorded during the run.
- `tests/maestro_e2e/logs/server.log`: Axum backend request logs.
