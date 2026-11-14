# COMMITS.md - Repository Change Log

Chronological log of significant changes in RRWR (Rust-Ruffle WebComic Reader).

---

## `2026-11-13 20:40` - `docs(governance)`: Rebrand documentation, workflows, and agent governance to RRWR

- **Description:** Removed all legacy branding and story-specific references across CI workflows, root documentation, and `.agents/` governance files, standardizing on `RRWR (Rust-Ruffle WebComic Reader)`.
- **Files Modified:**
  - `.github/workflows/release.yml`
  - `.github/workflows/staging.yml`
  - `.github/workflows/android-release.yml`
  - `README.md`, `AGENTS.md`, `GATE_STATUS.md`, `TEST_INFRA.md`, `TEST_READY.md`
  - `.agents/AGENTS.md`, `.agents/ARCHITECTURE.md`, `.agents/DESIGN.md`, `.agents/CURRENT.md`, `.agents/COMMITS.md`
  - `.agents/rules/*`, `.agents/agent/*`, `.agents/workflows/*`, `.agents/scripts/*`, `.agents/hooks/README.md`
- **Impact / Next Steps:** Governance, CI packaging, and agent prompts are now 100% generic for RRWR.

## `2026-11-13 21:11` - `feat(test)`: Integrate tauri-pilot v0.8.1 for debug automation

- **Description:** Integrated `tauri-plugin-pilot` v0.8.1 gated behind `#[cfg(debug_assertions)]` in `src-tauri/src/lib.rs` with `"pilot:default"` capability permission, verified live UI responsiveness, IPC calls, screenshot inspection, and aggressive E2E stress testing across no-asset, asset-pack, mod-overlay, traversal, and range boundaries.
- **Files Modified:**
  - `Cargo.lock`
  - `src-tauri/Cargo.toml`
  - `src-tauri/capabilities/default.json`
  - `src-tauri/src/lib.rs`
  - `.agents/CURRENT.md`
  - `.agents/COMMITS.md`
- **Impact / Next Steps:** Release builds incur zero `tauri-pilot` overhead while debug builds support full live `tauri-pilot` automation and inspection.
