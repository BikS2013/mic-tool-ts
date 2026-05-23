# Plan 023: Overlay Hide Diagnostics

Refined request: `docs/reference/refined-request-overlay-hide-diagnostics.md`.

Codebase scan: skipped because the preceding read-only investigation localized the exact integration points: `src/ui/electronMain.ts`, `src/ui/globalHotkeyManager.ts`, `src/ui/transcriptionOverlay.ts`, `src/ui/transcriptionOverlayState.ts`, and the focused UI tests.

## Objective

Add privacy-safe verbose diagnostics around the hotkey/capture/overlay lifecycle so a live run can prove why the overlay disappears after speech is interrupted or paused.

## Implementation Steps

1. Add source-aware press/release callback metadata to `GlobalHotkeyManager`.
2. Add Electron main diagnostics for hotkey press/release and `capture.state` transitions.
3. Add overlay action diagnostics through `TranscriptionOverlayManager`.
4. Keep diagnostics gated by the existing verbose config path and renderer-only event delivery to avoid recursive overlay diagnostics.
5. Add focused tests for source metadata and no transcript leakage in overlay diagnostic summaries.

## Files to Modify

- `src/ui/globalHotkeyManager.ts`
- `src/ui/electronMain.ts`
- `src/ui/transcriptionOverlay.ts`
- `src/ui/transcriptionOverlayState.ts`
- `tests/ui-global-hotkey-manager.test.ts`
- `tests/ui-transcription-overlay.test.ts`
- `docs/design/project-design.md`
- `docs/design/project-functions.md`
- `Issues - Pending Items.md`

## Acceptance Criteria

- Hotkey diagnostics include the press/release source and current session flags.
- Capture diagnostics include state, reason, hotkey/session flags, gate-open state, and warm recycle timer activity.
- Overlay diagnostics include action and phase data without transcript text.
- Verbose disabled remains quiet.
- Focused tests and type checking pass.
