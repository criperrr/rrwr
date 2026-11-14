# CURRENT.md - Project State & Navigation Index

Concise state and file index for RRWR (Rust-Ruffle WebComic Reader). Keep under 100 lines.

## 1. Active State
- **Project:** RRWR (Rust-Ruffle WebComic Reader - Tauri 2.0 / Rust)
- **Status:** Clean generic codebase on `dev` with zero third-party comic references; `tauri-pilot` v0.8.1 debug automation integrated (`#[cfg(debug_assertions)]`).
- **Quality Gates:** `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (57 unit + 3 adversarial), `python3 tests/e2e_runner.py` (68/68), release RSS < 150MB SLA.

## 2. Navigation Index
- **Backend (`src-tauri/src/`):**
  - `lib.rs`, `main.rs`, `commands.rs`: Tauri builder, WebKitGTK setup, debug `tauri_plugin_pilot`, IPC handlers.
  - `server/` (`mod.rs`, `vfs.rs`, `handler.rs`): Axum loopback server, VFS overlay + `Vfs::sanitize_path`, HTTP 206 streaming.
  - `data/` (`mod.rs`, `story.rs`, `music.rs`, `tree.rs`): In-memory `ArchiveStore`, `story.json` / `music.json`, tree browsing.
  - `config/mod.rs`: `~/.config/rrwr/config.json` atomic persistence, settings, tabs, save cartridges.
  - `mods/` (`mod.rs`, `parser.rs`, `patcher.rs`): Mod registry, `mod.js` parser, localization patches.
  - `imports.rs`, `rpc/mod.rs`: Asset Pack validation, folder/ZIP imports, Discord RPC.
- **Frontend (`src/`):**
  - `index.html`, `styles/main.css`: UI shell, themes, native-refresh animations.
  - `js/` (`app.js`, `animations.js`, `mediaEngine.js`, `flashProps.js`, `modHooks.js`, `debugHud.js`, `perfMonitor.js`, `genericIcons.js`).
- **Tests (`tests/`):** `e2e_runner.py`, `mock_server.py`, `tier1_features/`..`tier4_realworld/`, `frontend_e2e/`, `maestro_e2e/`.
