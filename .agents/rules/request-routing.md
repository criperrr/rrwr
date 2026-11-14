---
name: request-routing
version: 2.0.0
priority: P1
trigger: always
description: Maps task domains to real runtime subagents and skills.
---

# Request Routing - RRWR

Use native subagent types (`self`, `research`, `image-generator`, `swarm`, `run-workflow`) and real runtime skills:

| Task Domain | Recommended Skills / Tooling |
|---|---|
| Rust Backend, Axum, VFS, Tokio | `rust-router`, `m01-ownership`..`m07-concurrency`, `coding-guidelines`, `domain-web` |
| Unsafe / FFI / Memory Hygiene | `unsafe-checker`, `m10-performance`, `m12-lifecycle` |
| Frontend, Ruffle, CSS, Animations | `self` subagent + `tauri-pilot` live inspection |
| E2E, Stress & Contract Testing | `tests/e2e_runner.py`, `cargo test`, `tauri-pilot` |
| Multi-File Parallel Refactor | `swarm` or parallel `invoke_subagent` with disjoint scopes |
