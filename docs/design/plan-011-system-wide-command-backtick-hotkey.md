# Plan 011: System-Wide Command-Backtick Hotkey

Refined request: `docs/reference/refined-request-system-wide-command-backtick-hotkey.md`
Investigation: `docs/reference/investigation-system-wide-command-backtick-hotkey.md`
Codebase scan: `docs/reference/codebase-scan-system-wide-command-backtick-hotkey.md`

## Objective

Change the UI push-to-talk default hotkey to `Command+\`` and make push-to-talk work while another macOS app is focused.

## Approach

Add `uiohook-napi` as a vetted runtime dependency and isolate it behind `src/ui/globalHotkeyManager.ts`. The manager listens for global keydown/keyup, matches the currently configured UI hotkey, and calls the same hotkey-owned start/stop callbacks already used by the UI path. Electron `globalShortcut` is not sufficient because it does not expose release events.

## Files to Modify

- `package.json` / `pnpm-lock.yaml`
- `src/ui/shared.ts`
- `src/ui/hotkey.ts`
- `src/ui/globalHotkeyManager.ts`
- `src/ui/electronMain.ts`
- `tests/ui-hotkey.test.ts`
- `tests/ui-global-hotkey-manager.test.ts`
- `README.md`
- `docs/tools/mic-tool-ts.md`
- `docs/design/project-functions.md`
- `docs/design/project-design.md`
- `Issues - Pending Items.md`

## Acceptance Mapping

- Default hotkey is `Command+\``.
- System-wide keydown starts a hotkey-owned session.
- System-wide keyup stops that session with pending submission.
- Focused-window fallback remains available.
- Native hook failures warn and do not crash UI mode.
- Dependency vetting and audit pass.

## Risks

- macOS may require Accessibility/Input Monitoring permissions for the launching app.
- `Command+\`` may still trigger frontmost-app window cycling because this feature observes the key, it does not promise to suppress the OS/app shortcut.
- Native module packaging may need additional work if the project later ships a signed standalone app.


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
