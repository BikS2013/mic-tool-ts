# Plan 010: UI Push-To-Talk Hotkey

Refined request: `docs/reference/refined-request-ui-push-to-talk-hotkey.md`
Investigation: `docs/reference/investigation-ui-push-to-talk-hotkey.md`
Codebase scan: `docs/reference/codebase-scan-ui-push-to-talk-hotkey.md`

## Objective

Add a configurable push-to-talk hotkey to `mic-tool-ts ui`: key press starts capture/transcription; key release stops capture and submits the captured final transcript to the existing protocol/refinement pipeline.

## Approach

Use focused Electron renderer keyboard events rather than a global shortcut. This keeps key-release handling reliable without adding a dependency or new macOS permissions. The first version is intentionally scoped to the UI window having focus.

## Files to Modify

- `src/ui/hotkey.ts` — new pure hotkey parser and keyboard-event matcher.
- `src/ui/shared.ts` — add `hotkeyEnabled` and `hotkey` to `RendererSettings`.
- `src/ui/preload.cts` — allow stop requests to include submit-pending behavior.
- `src/ui/electronMain.ts` — pass hotkey stop intent into the session abort reason.
- `src/ui/renderer/app.ts` — add controls, settings parsing, and keydown/keyup push-to-talk flow.
- `src/ui/renderer/index.html` — add hotkey enable and combination controls.
- `src/core/sessionRunner.ts` — read UI abort reason and call protocol end with submit-pending when requested.
- `src/protocol/controller.ts` — add end-session options.
- `src/protocol/stateMachine.ts` — add pending-section submit drain behavior.
- `tests/ui-settings.test.ts` and `tests/protocol.test.ts` — add focused regression coverage.
- Documentation under `docs/design/`, `docs/tools/`, and `README.md`.

## Acceptance Mapping

- UI controls exist for enabling/disabling and editing the hotkey.
- Invalid hotkey text is rejected by shared settings validation.
- Hotkey keydown starts only one hotkey-owned session.
- Hotkey keyup stops only the hotkey-owned session and submits pending text.
- Manual Start/Stop remains independent and does not submit pending text on stop.
- Existing build/test/typecheck commands pass.

## Risks

- True global push-to-talk is not implemented in this plan. If required later, it needs a separate investigation for native key-release capture and macOS permissions.
- Final transcript availability still depends on the active STT provider returning final tokens during transcriber stop/finalize.
