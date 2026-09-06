---
status: accepted
---

# Tauri v2 is the desktop shell

The app must run on macOS and Windows, ship as a signed installer, and show a preview of the exact ZPL it sends. We chose Tauri v2: the webview runs the existing zebrash-ts renderer unchanged, the bundler produces signed DMG and NSIS installers, and Rust only has to cover printer transport and the print log.

## Considered options

- **Electron**: same capabilities, everything in TypeScript, but a 150 MB app for a three-screen tool.
- **vercel-labs/native (Native SDK)**: small native binary and a good macOS story, but in September 2026 its Windows output is a bare directory with no installer and no signing step, its TypeScript core cannot call libraries, and showing a runtime-rendered preview needs a Zig component. Judged too brittle for clinic machines.
