# DIN Replicator

Desktop app (Tauri v2, React, Rust) that scans an ISBT 128 DIN label and prints replica labels on a USB Zebra ZD411t at 300 dpi on 1.75 x 0.75 inch label stock.

Read `CONTEXT.md` before writing code or prose. Use its terms exactly, including in identifiers. Decisions that are hard to reverse are in `docs/adr/`. Do not reopen them in code without a new ADR.

## Layout

- `src/` React UI (Tailwind, shadcn). Plain React state, no data-fetching library.
- `src/lib/isbt128/` pure TypeScript: scan parsing, DIN validation, check character, barcode payload. No DOM, no Tauri imports.
- `src/lib/label/` pure TypeScript: ZPL for the replica label and the zebrash preview.
- `src-tauri/src/` Rust: printer transport (`printer/`), print log (`log/`), Tauri commands (`commands.rs`).
- `docs/adr/` architecture decision records. `CONTEXT.md` glossary.

## Commands

- `bun install` then `bun run tauri dev` runs the app.
- `bun test` runs vitest for `src/`. `cargo test` inside `src-tauri/` runs Rust tests.
- `bun run check` runs typecheck, oxlint, and oxfmt --check. Run it before every commit.
- `bun run preview:label` renders the replica label ZPL to `out/label.png` with zebrash for visual review.

## Rules

- ISBT 128 facts come from ICCBBA ST-001 v6.2.2. Cite the section in a comment when code implements a rule from it.
- Every ISBT 128 function is covered by the IG-043 vectors and the sample label `W483626000011` (K = N), which was scanned from a production label.
- Comments describe the code as it is now, for a reader who knows the goal of the project but not this codebase. History belongs in commit messages.
- Prose (comments, docs, commit messages) is plain English: short sentences, active voice, no rhetorical patterning, no em dashes.
- Commits are atomic: one logical change, tests passing, described in one sentence.
- Never use a dependency version from memory. Check the registry.
- This project is open source. No company name, person name, or internal system detail appears in code, comments, tests, strings, paths, or docs. The bundle identifier is `org.dinreplicator.app`.
- Platform-specific code lives in a directory named for the platform: `macos/` or `windows/`. Shared code never sits beside platform code in the same file.
