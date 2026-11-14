# AGENTS.md - RRWR System Guidelines

Keep every `.agents/*.md` file under 100 lines so agents read complete context without truncation.

## 1. Navigation & Context Efficiency
- Read `.agents/CURRENT.md` first before broad searches.
- Search with exact symbols (`rg -n`) and read bounded line ranges (`StartLine`/`EndLine`).
- Use real runtime skills (`rust-router`, `m01-ownership`..`m15-anti-pattern`, `unsafe-checker`, `coding-guidelines`, `domain-web`, `swarm`, `run-workflow`) and real tools (`read_file`, `edit_file`, `write_file`, `run_command`, `invoke_subagent`).

## 2. Architecture & Memory SLA (< 150MB RSS)
- **Tauri 2.0 + Axum (`src-tauri/src/`):** `commands.rs` is a thin IPC layer delegating to `AppState`; `server/vfs.rs` resolves overlays and sanitizes all paths via `Vfs::sanitize_path`; `server/handler.rs` streams assets zero-copy with HTTP 206 Range support.
- **Data & Mods:** `ArchiveStore` (`story.rs`, `music.rs`) applies mod patches in-memory on-read without duplicating archives; `config/mod.rs` persists `~/.config/rrwr/config.json`.
- **Frontend (`src/`):** WebKitGTK/WebView2 shell (`index.html`, `js/app.js`, `js/mediaEngine.js`, `js/modHooks.js`, `js/animations.js`, `styles/main.css`) with Ruffle WASM.
- **Memory Budget:** Total RSS must remain strictly **< 150MB** in release builds (`CacheModel::DocumentViewer`, `libc::malloc_trim(0)`, chunked streaming).

## 3. Git, CI/CD & Behavioral Rules
- **Branching:** Always branch from `dev` (`git checkout -b <type>/<task> dev`) before any edit. Never edit `main` or `dev` directly.
- **Commits:** `<type>(<scope>): <short-description>` (`feat`, `fix`, `test`, `refactor`, `chore`, `docs`). Stage only files from the current task.
- **PR & Branch Closing:** NEVER create a PR, merge, or close/delete a branch automatically. Always ask the user first if the branch can be closed, and suggest closing it once the initially requested feature is implemented and verified. When authorized to merge, push, `gh pr create --base dev` (lowercase plain text, no markdown/headings/bullets/emojis), watch `gh pr checks <PR> --watch`, then `gh pr merge --squash --delete-branch`.
- **Protected Zones:** Never weaken tests, assertions, timeouts, or `< 150MB` thresholds in `tests/` or `.github/workflows/`.
- **Zero Emojis:** Strictly zero emojis in responses, code, comments, commits, PRs, or docs.
- **Verification & Screenshots:** Run `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, and `python3 tests/e2e_runner.py` before finishing. Save `tauri-pilot` screenshots in `/tmp/`, inspect them carefully with `read_file`, and NEVER delete them from `/tmp/`.
