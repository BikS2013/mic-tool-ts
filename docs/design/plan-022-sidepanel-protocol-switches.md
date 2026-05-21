# Plan 022: Sidepanel Protocol Switches

Refined request: `docs/reference/refined-request-sidepanel-protocol-switches.md`

## Goal

Add right-inspector controls for the four protocol operator switches and make those switches live-editable while UI sessions are warmed, recording, or listening.

## Approach

Reuse the existing renderer settings model and protocol runtime toggle path. Add sidepanel switch inputs for refine, translate, clipboard, and focused input; tag protocol switch controls separately from general settings controls so they remain enabled during active sessions. In Electron main, route requested switch-state changes through a session-wide protocol feature control so both manual and hotkey-owned sessions can update their active `VoiceAgentProtocolController`.

## Files to Modify

- `src/ui/renderer/index.html`
- `src/ui/renderer/app.ts`
- `src/ui/renderer/styles.css`
- `src/ui/electronMain.ts`
- `tests/main.test.ts`
- `test_scripts/verify-ui-bridge.cjs`
- `README.md`
- `docs/tools/mic-tool-ts.md`
- `docs/design/project-functions.md`
- `docs/design/project-design.md`
- `Issues - Pending Items.md`

## Acceptance Criteria

- Right inspector has only the four protocol operator switches.
- Protocol view and inspector switch states stay synchronized.
- Protocol switches remain enabled in `running`, `warm`, and `recording`; other settings remain disabled.
- Active sessions receive runtime protocol state changes from switch edits.
- `pnpm typecheck`, focused tests, `pnpm test`, `pnpm build`, and the Electron bridge verification pass.
