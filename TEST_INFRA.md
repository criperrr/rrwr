# E2E Test Infrastructure: RRWR Tauri 2.0

## 1. Overview & Objectives

This document specifies the architecture, methodology, and execution contracts of the End-to-End (E2E) Test Suite for RRWR (Rust-Ruffle WebComic Reader).

The test suite operates under a **Dual-Track Testing Architecture**:
- **Requirement-Driven & Opaque-Box**: Tests validate externally observable behaviors across HTTP endpoints, IPC protocols, virtual file system (VFS) overlays, data serialization, and configuration persistence without binding to internal implementation details.
- **Progressive Testability & Independence**: Tests are fully self-contained, isolated, order-independent, and derive ground-truth expectations directly from verified reference fixtures.
- **Dual Execution Engine**: Supports both direct contract/oracle execution (with an integrated Axum-compatible contract server backed by synthetic/local asset packs) and live-attach execution against the running Tauri 2.0 application backend.

---

## 2. Authoritative Reference Fixtures

Test assertions are anchored to deterministic asset pack and archive structures:

| Fixture Source | Path / Format | Verification Role |
|---|---|---|
| **Asset Pack** | `<asset_pack_root>/` | File existence, exact byte sizes, MIME typing, and Range response verification for media, audio, and SWF assets. |
| **Story Archive** | `<asset_pack_root>/archive/data/story.json` | Canonical comic pages, media mappings, page titles, page IDs, next/previous links, and metadata flags. |
| **Music Archive** | `<asset_pack_root>/archive/data/music.json` | Albums, musical tracks, artists, durations, and flash sync references. |
| **Mod Pack** | `<mods_root>/<mod_id>/` | `mod.js` syntax & trees mapping (`./Assets/` -> `assets://`), `translation.json` / `translation2.json` page translations, and localized replacement assets. |
| **Flash Calibration** | `flash_props` configuration | Millisecond audio delay calibrations (`audioDelay`), negative seek offsets, multi-segment timings, and viewport dimensions. |
| **App Configuration** | `~/.config/rrwr/config.json` | Schema, active tabs, history arrays, reader progress (`readingProgress`), theme overrides, and `modListEnabled` format. |

---

## 3. Four-Tier Test Taxonomy

### Tier 1: Feature Coverage (Core Requirements)
Covers baseline happy paths for all foundational features:
1. **Asset Server (F03)**: Loopback HTTP requests, status 200 OK, MIME headers (GIF, PNG, MP3, SWF, WASM), Range headers (`bytes=0-1023`), Content-Length accuracy.
2. **In-Memory Store (F04)**: Story page querying, story ranges, music archive retrieval, album listing.
3. **Config & Save Persistence (F05)**: Config read, config mutation & write-back, schema integrity, tab data persistence, settings preservation.
4. **Tauri Core IPC APIs (F06)**: IPC command handling for `get_app_info`, `get_story_page`, `get_story_range`, `get_music_data`, `load_config`, `save_config`, `get_available_mods`, `toggle_mod`.
5. **Webview Asset Loading (F07/F09)**: Static web assets, fonts, stylesheets, theme definitions, Ruffle emulator assets.

### Tier 2: Boundary & Corner Cases (Robustness & Error Handling)
Verifies boundary conditions, error handling, and security resilience:
1. **Missing Assets (404 Handling)**: Non-existent paths, traversal attacks (`../../etc/passwd`), null-byte injections, empty path queries.
2. **Out-of-Bounds Story Queries**: Invalid page IDs, negative page numbers, out-of-range page IDs, invalid alphanumeric non-page IDs, empty string IDs.
3. **Malformed & Invalid Mods**: Directory without `mod.js`, invalid JavaScript syntax, missing translation files, missing `Assets` folder, cyclic tree mappings.
4. **Malformed Range Requests**: Syntactically invalid ranges (`bytes=xyz`), open-ended ranges exceeding file length, inverted ranges (`bytes=100-50`), empty range strings.
5. **Malformed IPC / Config Payloads**: Empty request bodies, invalid JSON syntax, missing required fields, type mismatches (string instead of boolean).

### Tier 3: Cross-Feature Combinations (Pairwise Interaction)
Validates interactions between disparate subsystems operating simultaneously:
1. **Mod Overlay + Story Fetch**: Translation text merged into story payload while localized media is simultaneously served via the VFS.
2. **Mod Toggle + Config Persistence**: Toggling a mod updates in-memory registry, flushes `modListEnabled` to `config.json`, and reflects immediately on next asset query.
3. **Audio Delay Calculation + Flash Asset**: Fetching a Flash SWF combined with lookup in audio delay calibration tables (positive delays, negative delays, multi-segment splits).
4. **Theme Override + Story Page Layout**: Setting custom theme in config affects story page metadata and style resolution.
5. **Range Streaming on Localized Asset vs Base Asset**: Range requests on base asset vs localized asset return respective byte slices without corruption.

### Tier 4: Real-World Scenarios (End-to-End User Workflows)
Simulates end-to-end user journeys mirroring actual reader sessions:
1. **Sequential Story Reader Walkthrough**: Traversing consecutive pages, validating navigation chains, title updates, and history tracking.
2. **Flash Audio Sync Scenario**: Loading animated Flash pages, verifying `.swf` asset streaming, `#audioStart` Frag IPC dispatch, and delay calibration.
3. **Localized Reading Session**: Enabling a translation mod, verifying translated titles, body text, dialog log button text hooks, and localized graphics.
4. **Music Player Sound Test**: Querying album discography, inspecting track metadata, verifying audio streaming endpoints.
5. **Tab Session Save & Restore**: Creating multi-tab sessions with history stacks, saving state, restarting session, and validating full state restoration.

---

## 4. Test Runner Architecture (`tests/e2e_runner.py`)

The test harness is implemented in pure Python 3 (standard library only) to ensure zero setup friction, fast startup, and universal CI/CD compatibility.

```
tests/
├── e2e_runner.py                       # CLI test runner & orchestrator
├── common.py                           # Test harness base, assertion helpers, HTTP client, fixtures
├── mock_server.py                      # Reference contract backend (Axum/Tauri contract simulator)
├── tier1_features/
│   ├── test_asset_server.py            # F03 Asset server & range streaming
│   ├── test_monolithic_store.py        # F04 In-memory JSON store
│   ├── test_config_persistence.py      # F05 Config & save manager
│   ├── test_ipc_contracts.py           # F06 Tauri IPC APIs
│   └── test_webview_assets.py          # F07/F09 Webview assets & styling
├── tier2_boundaries/
│   ├── test_missing_assets.py          # 404s & path traversal protection
│   ├── test_out_of_bounds_pages.py     # Out-of-bounds page IDs
│   ├── test_invalid_mods.py            # Corrupt/missing mod structures
│   ├── test_malformed_ranges.py        # Malformed HTTP Range requests
│   └── test_malformed_payloads.py      # Malformed IPC/Config bodies
├── tier3_combinations/
│   ├── test_mod_overlay_story.py       # Translation + VFS overlay
│   ├── test_mod_toggle_persistence.py  # Runtime toggle & config persistence
│   ├── test_audio_sync_flash.py        # Flash props + audio delay offsets
│   ├── test_theme_story_nav.py         # Config theme override + story reader
│   └── test_range_streaming_overlay.py # Range requests on VFS overlay assets
└── tier4_realworld/
    ├── test_sequential_reading.py      # Sequential page walkthrough
    ├── test_flash_audio_sync.py        # Flash audio sync scenarios
    ├── test_ptbr_reading_session.py    # Localized reader workflow
    ├── test_music_player_session.py    # Sound test & track player
    └── test_tab_session_restore.py     # Tab state preservation & restore
```

### Command-Line Interface

```bash
# Run all test tiers (auto-spawns reference contract server on ephemeral port)
python3 tests/e2e_runner.py

# Run a specific tier
python3 tests/e2e_runner.py --tier 1
python3 tests/e2e_runner.py --tier 2
python3 tests/e2e_runner.py --tier 3
python3 tests/e2e_runner.py --tier 4

# Run against a live running Tauri 2.0 backend
python3 tests/e2e_runner.py --live --url http://127.0.0.1:45100

# Filter tests by substring pattern
python3 tests/e2e_runner.py -k range

# Generate JSON report for CI/CD
python3 tests/e2e_runner.py --json-report test_report.json
```

---

## 5. Verification & Acceptance Criteria

1. **Deterministic Oracles**: Every test compares against observable physical files in the asset pack, story archive, music archive, and `config.json`.
2. **Zero Facade Testing**: No mock stubs that bypass validation; all HTTP queries send real socket requests, verify HTTP headers, and read exact binary byte payloads.
3. **Coverage Compliance**:
   - Tier 1: >= 25 tests across core features.
   - Tier 2: >= 25 tests across boundary domains.
   - Tier 3: >= 5 tests across pairwise feature combinations.
   - Tier 4: >= 5 real-world end-to-end user journeys.
4. **Execution Speed**: Full suite runs in < 5 seconds.
