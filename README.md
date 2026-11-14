# RRWR (Rust-Ruffle WebComic Reader)

A native, lightweight, offline-first desktop and mobile webcomic reader built with **Tauri 2.0**, **Rust**, **Axum**, and **Ruffle WebAssembly**.

```
+-------------------------------------------------------------------------+
| RRWR: RUST-RUFFLE WEBCOMIC READER (TAURI 2.0 / RUST)                    |
| Total Process Resident Set Size (RSS): < 100 MB (Hard SLA: < 150 MB)    |
| Startup Latency: < 150 ms  |  Zero-Copy Streaming  |  100% Offline VFS  |
+-------------------------------------------------------------------------+
```

---

## Table of Contents

- [Quick Start](#quick-start)
  - [Step 1: Prepare an Asset Pack](#step-1-prepare-an-asset-pack)
  - [Step 2: Installation (Linux)](#step-2-installation-linux)
- [Reader Capabilities](#reader-capabilities)
- [Technical Architecture](#technical-architecture)
  - [1. Macro Topology and Process Isolation](#1-macro-topology-and-process-isolation)
  - [2. Embedded Axum Loopback and Zero-Copy Streaming](#2-embedded-axum-loopback-and-zero-copy-streaming)
  - [3. Layered Virtual File System (VFS) and Mod Resolution](#3-layered-virtual-file-system-vfs-and-mod-resolution)
  - [4. In-Memory Story Store and On-Read Patching](#4-in-memory-story-store-and-on-read-patching)
  - [5. Ruffle WebAssembly Flash Pipeline](#5-ruffle-webassembly-flash-pipeline)
  - [6. Memory Hygiene and Heap Compaction](#6-memory-hygiene-and-heap-compaction)
  - [7. Dual-Track Testing Harness](#7-dual-track-testing-harness)
- [Building from Source](#building-from-source)
- [License](#license)

---

## Quick Start

### Step 1: Prepare an Asset Pack

RRWR does not bundle story media inside the executable. It mounts a user-supplied local asset pack directory containing story JSON archives, media panels, Flash `.swf` animations, and optional audio tracks.

1. Place your asset pack directory on local storage (for example, `~/Downloads/AssetPack` or `~/.local/share/rrwr/AssetPack`).
2. Verify that the directory contains `archive/data/` (with `story.json` / `music.json`) and media subdirectories (`storyfiles/`, `images/`, etc.).
3. On first launch, select this folder in the application setup dialog.

### Step 2: Installation (Linux)

#### Ubuntu / Debian / Linux Mint / Pop!_OS (`.deb`)

```bash
sudo apt update
sudo apt install ./rrwr_<version>_amd64.deb
```

*Required system dependencies:* `libwebkit2gtk-4.1-0`, `libgtk-3-0`, `libayatana-appindicator3-1`.

#### Fedora / RHEL / openSUSE (`.rpm`)

```bash
sudo dnf install ./rrwr-<version>-1.x86_64.rpm
```

*Required system dependencies:* `webkit2gtk4.1`, `gtk3`, `libayatana-appindicator-gtk3`.

#### Universal AppImage (All Linux Distributions)

```bash
chmod +x rrwr_<version>_amd64.AppImage
./rrwr_<version>_amd64.AppImage
```

---

## Reader Capabilities

- **Customizable Themes & Typography:** Built-in theme presets and stylesheet overrides with monospace and readable serif/sans options for story text, dialog logs, and settings.
- **Tabbed Browsing Shell:** Multi-tab reader with keyboard shortcuts (`Ctrl+T` new tab, `Ctrl+W` close tab, `Ctrl+Shift+T` restore closed tab with preserved history stack, `Ctrl+1..0` tab selection, `Ctrl+R` refresh).
- **Save Cartridges & Flash Persistence:** Automatic reading progress tracking, manual save snapshots, and Ruffle SharedObject (`.sol`) persistence to native disk storage.
- **Audio Player & Sound Test Bar:** Archival browser for albums and musical tracks with a persistent bottom player bar, scrub bar, and volume controls.
- **Discord Rich Presence (Privacy-First):** Optional local IPC integration displaying current story page or audio playback status without leaking configuration data.
- **Community Mod Engine:** Supports `mod.js` definitions, virtual asset trees (`trees`, `treeroute`), exact asset remapping (`routes`), stylesheet overrides (`styles`), footnotes, and JSON translation overlays.

---

## Technical Architecture

### 1. Macro Topology and Process Isolation

```
Webview Frontend (HTML5 / Ruffle WASM)
      | (HTTP /assets/* or /ipc/*)        | (Tauri invoke IPC)
      v                                   v
Axum Loopback Server               Tauri Commands
      |                                   |
      +-----------------+-----------------+
                        v
     Virtual File System (VFS + Mods) | Archive Store | App Config
```

### 2. Embedded Axum Loopback and Zero-Copy Streaming

- Runs an embedded Axum + Tower-HTTP server bound to an ephemeral loopback port (`127.0.0.1:0`).
- Supports HTTP `206 Partial Content` (`Range: bytes=start-end`) for streaming large Flash `.swf` and audio files without loading entire files into memory.

### 3. Layered Virtual File System (VFS) and Mod Resolution

- Checks active mod overlay trees in priority order before falling back to the base asset pack directory.
- Sanitizes every incoming URI path via `Vfs::sanitize_path` to prevent directory traversal (`..`) and null-byte injection.

### 4. In-Memory Story Store and On-Read Patching

- `ArchiveStore` holds immutable shared references to loaded `StoryStore` and `MusicStore` indices.
- Translation and mod patches are merged in memory on read without mutating base archive files on disk.

### 5. Ruffle WebAssembly Flash Pipeline

- Embeds Ruffle WASM for legacy `.swf` animations and interactive pages.
- Supports millisecond audio delay calibration tables and multi-segment playback synchronization via `#audioStart` Frag IPC events.

### 6. Memory Hygiene and Heap Compaction

- WebKitGTK cache model is configured as `CacheModel::DocumentViewer` with page cache disabled.
- Invokes `libc::malloc_trim(0)` on Linux after closing heavy tabs or completing large archive indexing to return unused pages to the OS, keeping total process RSS strictly under 150 MB.

### 7. Dual-Track Testing Harness

```bash
# Execute Rust unit and integration tests
cargo test --workspace

# Execute Python E2E Dual-Track Test Suite
python3 tests/e2e_runner.py

# Execute Memory RSS Gatekeeper (< 150 MB SLA)
python3 .agents/scripts/memory_check.py
```

---

## Building from Source

### Prerequisites

Ensure you have a modern Rust toolchain (2021 edition), Node.js, and native development libraries installed:

```bash
# Ubuntu / Debian
sudo apt install build-essential curl pkg-config \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev

# Fedora
sudo dnf install @development-tools \
  webkit2gtk4.1-devel gtk3-devel libayatana-appindicator-gtk3-devel librsvg2-devel

# Arch Linux
sudo pacman -S --needed base-devel webkit2gtk-4.1 gtk3 libayatana-appindicator
```

### Compilation

```bash
npm install
npm run tauri build
```

The resulting binaries and installation bundles (`.deb`, `.rpm`, `.AppImage`) will be located in `src-tauri/target/release/bundle/`.

---

## License

The Rust and web frontend source code in this repository is licensed under the **MIT License**.
