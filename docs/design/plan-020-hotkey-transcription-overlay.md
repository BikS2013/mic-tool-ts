# Plan 020 — Hotkey Transcription Overlay

Refined request: `docs/reference/refined-request-hotkey-transcription-overlay.md`
Investigation: `docs/reference/investigation-hotkey-transcription-overlay.md`
Codebase scan: `docs/reference/codebase-scan-hotkey-transcription-overlay.md`

## Objective

Implement the recommended independent bottom-center Electron overlay for UI push-to-talk recording. The overlay must be separate from the main UI window, consume the existing typed UI session event stream, show only for hotkey-owned capture, update live partial text in place, briefly show final/processed/warning/error states, then hide without persisting transcript text or stealing focus.

## Scope

- Add a pure overlay state reducer for `capture.state`, transcript, diagnostic, session stop, and error events.
- Add an Electron overlay window manager owned by `src/ui/electronMain.ts`.
- Add local packaged overlay renderer assets under `src/ui/renderer/`.
- Route hotkey-owned events to the overlay while preserving the existing main renderer event delivery.
- Update packaging, focused tests, and user/design documentation.

## Files To Modify

- `src/ui/electronMain.ts`
- `src/ui/preload.cts`
- `src/ui/shared.ts`
- `src/ui/transcriptionOverlay.ts`
- `src/ui/transcriptionOverlayState.ts`
- `src/ui/renderer/overlay.html`
- `src/ui/renderer/overlay.ts`
- `src/ui/renderer/overlay.css`
- `package.json`
- `tests/ui-transcription-overlay.test.ts`
- `docs/design/project-design.md`
- `docs/design/project-functions.md`
- `README.md`
- `docs/tools/mic-tool-ts.md`

## Out Of Scope

- STT provider behavior, microphone capture, LLM refinement, voice-agent protocol semantics, focused-input helper behavior, and CLI stdout rendering remain unchanged.
- No new runtime dependency is required.
- Overlay enable/disable settings are deferred until requested; no new persisted UI state is introduced.

## Implementation Steps

1. Implement a pure reducer that derives overlay snapshots and show/hide actions from existing `SessionEvent` values.
2. Implement the overlay `BrowserWindow` manager with display-only, non-focus-stealing window options and bottom-center placement from Electron `screen` work areas.
3. Extend the preload bridge with a one-way overlay snapshot subscription.
4. Add the overlay renderer HTML/TS/CSS and clamp long transcript text inside a stable compact bar.
5. Wire Electron main to create/destroy the overlay manager and feed it hotkey-owned events.
6. Update the build script to package overlay static assets.
7. Add focused unit coverage for state transitions and placement.
8. Sync project design, functional requirements, README, and tool docs.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

