---
language: TypeScript
framework: Electron
package_manager: pnpm
build_command: pnpm build
test_command: pnpm test
lint_command: null
entry_points:
  - src/index.ts
  - src/ui/launcher.ts
  - src/ui/electronMain.ts
last_scanned_commit: bf9c9904a47a6f5ab296a31d843d18491448d3fa
request_file: docs/reference/refined-request-ui-section-scrolling.md
scan_scope: request-driven Electron renderer section scrolling
generated_at: 2026-05-20
---

# Codebase Scan: UI Section Scrolling

## Module Map

- `src/ui/renderer/index.html` — defines the static Electron renderer regions: toolbar, sidebar, content views, inspector, and capture bar.
- `src/ui/renderer/styles.css` — owns all renderer layout, fixed app grid sizing, responsive breakpoints, and current overflow behavior.
- `src/ui/renderer/app.ts` — switches active panels, appends transcript/log rows, and auto-scrolls the transcript timeline.
- `src/ui/electronMain.ts` — creates the Electron `BrowserWindow` with fixed minimum dimensions and loads the packaged renderer.
- `tests/ui-renderer.test.ts`, `tests/ui-settings.test.ts`, and related UI tests — cover behavior and settings plumbing, not visual layout.

## Integration Points

In scope:
- `src/ui/renderer/styles.css` — make the existing major regions bounded scroll containers and preserve horizontal overflow access.
- `docs/design/project-functions.md` — add functional requirement for scrollable UI regions.
- `docs/design/project-design.md` — document the renderer overflow containment decision.
- `Issues - Pending Items.md` — record the resolved UI overflow issue.

Out of scope:
- `src/ui/renderer/app.ts` unless CSS-only changes break transcript auto-scroll.
- Electron main/preload IPC, transcription providers, protocol state machine, and hotkey logic.

## Duplication Check

The transcript timeline and inspector already have vertical `overflow: auto`, but settings/protocol panels do not. No alternate scroll manager exists. This request should extend the existing CSS layout rather than add JavaScript scrolling code.

## Conventions Observed

- The renderer uses a fixed `100vw` x `100vh` `.app-shell` grid and keeps `body` overflow hidden.
- Content surfaces use `min-width: 0` / `min-height: 0` to let CSS grid children shrink.
- The app avoids nested card styling; panels are unframed layout regions inside the main content area.
