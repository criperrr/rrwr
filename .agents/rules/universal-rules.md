---
name: universal-rules
version: 2.0.0
priority: P0
trigger: always
description: Always-active language, memory SLA, security, and zero-emoji rules.
---

# Universal Rules (TIER 0) - RRWR

- **Language:** Respond in the user's language; keep code, identifiers, comments, commits, and PRs in English.
- **Memory & Security:** Keep release RSS < 150MB and validate all VFS paths through `Vfs::sanitize_path`.
- **Zero Emojis:** Never use emojis in responses, commits, PRs, docs, logs, code, comments, or tests.
- **Screenshots:** Save `tauri-pilot` screenshots in `/tmp/`, inspect them carefully with `read_file`, and NEVER delete them from `/tmp/`.
- **No Auto-PR / Close:** NEVER create a PR or close a branch without asking the user first; suggest closing when the requested feature is complete.
