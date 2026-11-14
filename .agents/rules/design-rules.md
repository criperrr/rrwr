---
name: design-rules
version: 1.0.0
priority: P1
trigger: model_decision
description: Apply when implementing or updating UI components, themes, or Ruffle layout in RRWR.
---

# Design & Visual Rules (TIER 1) - RRWR

> Active when styling screens, themes, or Flash viewports.

---

## 1. WebComic Visual Fidelity

- **Page Layout:** Centralized comic frame (standard 650px content column, scalable for higher-DPI displays).
- **Typography:**
  - Story text: `Courier Prime`, `Courier New`, monospace, legible contrast.
  - Dialog logs: per-speaker color formatting preserved from story HTML/CSS.
- **Classic Themes:** Default light theme `#EEEEEE` background; support for theme overrides defined in `config.json` (`themeOverrideUI`, `forceThemeOverrideUI`).

---

## 2. Flash / Ruffle Emulation Viewport

- Must adhere to original dimensions:
  - Standard Flash: 650x450 px.
  - Large / Wide Flashes: Dynamic container sizing matching calibrated heights (`cropHeight`, `indexedFlashProps`).
- Viewport scaling: Maintain exact aspect ratio; letterbox if necessary without stretching pixels.
