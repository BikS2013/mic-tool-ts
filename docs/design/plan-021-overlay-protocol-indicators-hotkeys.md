# Plan 021: Overlay Protocol Indicators And Hotkeys

References:
- Refined request: `docs/reference/refined-request-overlay-protocol-indicators-hotkeys.md`
- Codebase scan: `docs/reference/codebase-scan-overlay-protocol-indicators-hotkeys.md`
- Prior overlay plan: `docs/design/plan-020-hotkey-transcription-overlay.md`

## Objective
Extend the independent push-to-talk overlay with protocol-feature indicators and add secondary runtime hotkeys that toggle the active protocol operators while the dictation hotkey is held.

## Files To Modify
- `src/protocol/stateMachine.ts` - expose runtime operator toggle/set operations.
- `src/protocol/controller.ts` - route runtime toggles through the same `state.changed` protocol event path as spoken commands.
- `src/core/sessionRunner.ts` - subscribe the active protocol controller to hotkey-owned runtime feature toggles.
- `src/ui/electronMain.ts` - publish secondary toggle requests from the hotkey session, track latest protocol feature state, and pass it to overlay snapshots.
- `src/ui/globalHotkeyManager.ts` - detect `R`, `T`, `C`, and `I` while the dictation hotkey is pressed.
- `src/ui/shared.ts` and `src/ui/preload.cts` - add a narrow preload method for focused-window runtime toggles.
- `src/ui/renderer/app.ts` - support focused-window fallback secondary toggles and reflect `state.changed` events in visible controls.
- `src/ui/transcriptionOverlay.ts` and `src/ui/transcriptionOverlayState.ts` - include protocol feature state in overlay snapshots and resize bounds.
- `src/ui/renderer/overlay.html`, `overlay.ts`, and `overlay.css` - render compact protocol indicators.
- `tests/ui-transcription-overlay.test.ts`, `tests/ui-global-hotkey-manager.test.ts`, and `tests/protocol.test.ts` - add focused coverage.
- `README.md`, `docs/tools/mic-tool-ts.md`, `docs/design/project-functions.md`, and `docs/design/project-design.md` - document behavior.

## Implementation Steps
1. Add runtime protocol toggle support to the state machine and controller.
2. Add a session-runner subscription interface for protocol feature toggles.
3. Extend the hotkey-owned session control in Electron main to queue and publish toggles to the active controller.
4. Detect secondary keys while push-to-talk is held: `R=refine`, `T=translate`, `C=clipboard`, `I=input`.
5. Keep overlay context and the main renderer synchronized from `protocol.event` / `state.changed`.
6. Render four compact overlay indicators with stable dimensions and enabled/disabled states.
7. Verify with type checking, unit tests, and build.

## Acceptance Checks
- Overlay snapshots include current protocol feature state.
- Overlay renderer shows all four indicators without changing transcript persistence behavior.
- Runtime hotkeys produce normal `state.changed` events.
- Spoken protocol state changes still update indicators.
- Existing push-to-talk press/release behavior is unchanged.


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
