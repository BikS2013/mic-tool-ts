---
language: TypeScript
framework: Electron renderer with vanilla DOM TypeScript
package_manager: pnpm
build_command: pnpm run build
test_command: pnpm test
lint_command: null
entry_points:
  - src/index.ts
  - src/ui/electronMain.ts
  - src/ui/renderer/app.ts
last_scanned_commit: 207979f
request_file: docs/reference/refined-request-ui-transcript-bubbles-clear.md
scan_scope: request-driven Electron UI transcript rendering and verification
generated_at: 2026-05-21T04:07:38Z
---

# Codebase Scan: UI Transcript Bubbles and Clear Action

## Module Map

- `src/ui/renderer/app.ts` — In-browser renderer state, settings parsing, session-event parsing, transcript timeline rendering, hotkey handling, and UI event binding. This is the main implementation target.
- `src/ui/renderer/index.html` — Static Electron renderer markup. The monitor top line and transcript timeline live here, making it the landing point for a clear-transcript button.
- `src/ui/renderer/styles.css` — Visual layout for toolbar/sidebar/content/timeline/transcript rows/bubbles. Existing transcript styles are already width-constrained and need extension for grouped bubbles.
- `src/render/uiRenderer.ts` — Converts the shared `Renderer` contract into typed UI session events: partial, final, turn boundary, refined.
- `src/core/sessionEvents.ts` — Authoritative typed UI session event union. Existing events do not carry a turn ID.
- `src/protocol/controller.ts` — Voice-agent section submission and processing. In UI mode it emits final raw text through `renderer.final(...)`, a turn boundary through `renderer.turnBoundary()`, and processed output through `renderer.refined(...)`.
- `test_scripts/verify-ui-bridge.cjs` — Electron verification harness that loads the packaged renderer, checks preload/settings bridge, and performs DOM layout assertions. This is the best focused UI verification target.
- `docs/design/project-functions.md` and `docs/design/project-design.md` — Authoritative feature/design docs for UI behavior.

## Conventions

- Renderer code uses strict DOM TypeScript with local type guards instead of importing app runtime modules into the browser bundle (`src/ui/renderer/app.ts`).
- UI state is held in a single `state` object; transcript rendering is driven by `renderTranscript()` replacing timeline children from `state.transcript`.
- The renderer never parses terminal output. It consumes typed `SessionEvent` values from the preload bridge.
- Markup is static in `index.html`; runtime DOM construction is used for repeated timeline/event rows.
- Focused UI verification is in `test_scripts/` and runs the built Electron renderer through `pnpm exec electron test_scripts/verify-ui-bridge.cjs`.

## Integration Points

### In-Scope

- `src/ui/renderer/app.ts`
  - Current `TranscriptItem` is a flat row model with `kind: "final" | "processed" | "partial" | "error"`.
  - `updatePartial()` keeps one partial row in the same array.
  - `commitTranscript()` removes partial rows and appends a new final/processed/error row.
  - `handleEvent()` routes `transcript.final` to `commitTranscript("final", ...)`, `transcript.refined` to `commitTranscript("processed", ...)`, and `transcript.turnBoundary` only to an event-log entry.
  - Requested grouping should replace the flat final/processed rows with a turn group model while keeping partial display.

- `src/ui/renderer/index.html`
  - `#timeline` is the transcript area.
  - `.content-topline` has the monitor segmented control and demo pill. It can accept a compact clear icon/button without disturbing the main capture controls.

- `src/ui/renderer/styles.css`
  - `.transcript-row`, `.bubble`, `.bubble.processed`, `.bubble.partial`, and `.bubble.error` already define the visual pattern to extend.
  - Mobile breakpoints already collapse transcript rows to one column.

- `test_scripts/verify-ui-bridge.cjs`
  - Currently injects raw `.transcript-row` fixtures for layout checks.
  - Should be extended to assert the clear button exists, grouped bubbles stay inside the monitor pane, and clear removes timeline entries/live text using the actual renderer surface where practical.

- `docs/design/project-functions.md`
  - Add a functional requirement for clearable grouped transcript history in the Electron UI section.

- `docs/design/project-design.md`
  - Update the Electron UI design section to document grouped turn rendering and clear semantics.

### Out-of-Scope

- CLI stdout renderer files under `src/render/renderer.ts`.
- STT provider clients under `src/soniox/` and `src/elevenlabs/`.
- Protocol state machine semantics under `src/protocol/stateMachine.ts`.
- Configuration resolver and settings persistence under `src/config.ts`, `src/ui/settingsStore.ts`, and `src/ui/runtimeSettings.ts`.

### New Integration Point

- A renderer-local turn grouping structure should be introduced inside `src/ui/renderer/app.ts`. Because `SessionEvent` lacks a turn/section ID for transcript events, the renderer should associate processed bubbles with the latest turn group and use `transcript.turnBoundary` as a grouping boundary signal.

## Duplication Check

The feature is partially implemented only as flat timeline rows:

- Final dictated text already appears as a bubble.
- Refined/processed output already appears as a later bubble.
- There is no clear transcript button.
- There is no grouped turn model that keeps raw dictated text and follow-up processed outputs visually associated.

Implementation should extend the existing renderer timeline rather than add a second transcript pane.


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
