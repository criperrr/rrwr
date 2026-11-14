---
name: quick-reference
version: 2.0.0
priority: P2
trigger: model_decision
description: Fast index of RRWR verification commands and real runtime skills.
---

# Quick Reference - RRWR

- **Format & Lint:** `cargo fmt --check && cargo clippy --all-targets -- -D warnings`
- **Rust Tests:** `cargo test`
- **E2E Contracts:** `python3 tests/e2e_runner.py`
- **Live UI Automation:** `tauri-pilot ping`, `tauri-pilot snapshot -i`, `tauri-pilot screenshot /tmp/<name>.png`
- **Memory Check:** `python3 .agents/scripts/memory_check.py`
- **Rust Skills:** `rust-router`, `coding-guidelines`, `m01-ownership`..`m15-anti-pattern`, `unsafe-checker`, `domain-web`
