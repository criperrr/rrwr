# RRWR System Architecture

RRWR uses a hybrid desktop architecture separating Rust/Axum I/O from the WebView UI. Keep under 100 lines.

## Layer Flow
```
Webview Frontend / Ruffle WASM (src/)
   | HTTP (/assets/*, /ipc/*)        | Tauri IPC (invoke)
   v                                 v
Axum Loopback (127.0.0.1:0)     Tauri Commands (commands.rs)
   |                                 |
   +----------------+----------------+
                    v
   VFS (vfs.rs)  |  ArchiveStore (data/)  |  AppConfig (config/)
```

## Key Components
1. **Virtual File System (`server/vfs.rs`):** Resolves enabled mod overlays -> user imports -> base Asset Pack. Enforces `Vfs::sanitize_path` against `..` and null-byte traversal.
2. **Zero-Copy Streaming (`server/handler.rs`):** Streams media/SWF/WASM via `Body::from_stream` with HTTP 206 `Range` support.
3. **In-Memory Stores (`data/`):** `StoryStore` and `MusicStore` hold immutable `Arc` base data and apply mod patches on-read without cloning archives.
4. **Mod Sandbox (`mods/` + `src/js/modHooks.js`):** Parses `mod.js` manifests, VFS trees/routes, CSS/SCSS styles, and `ArchiveProxy` diffs.
5. **Memory Hygiene:** WebKitGTK `CacheModel::DocumentViewer`, disabled page cache, and Linux `malloc_trim(0)` keep release RSS < 150MB.
