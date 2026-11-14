---
name: core-protocol
version: 2.0.0
priority: P0
trigger: always
description: Core operating principles for verification and surgical changes.
---

# Core Protocol (TIER 0) - RRWR

1. **Empirical Verification:** Never declare a task complete without running `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, and `python3 tests/e2e_runner.py` (plus `tauri-pilot` when UI behavior changes).
2. **Pragmatic Socratic Gate:** Ask the user before destructive actions or when requirements are genuinely ambiguous; do not stall on obvious conventions.
3. **Surgical Changes:** Edit only required files, preserve unrelated comments/docstrings, and keep every `.agents/*.md` file under 100 lines.
