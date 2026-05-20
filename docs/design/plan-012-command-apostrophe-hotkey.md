# Plan 012: Command-Apostrophe UI Hotkey

Refined request: `docs/reference/refined-request-command-apostrophe-hotkey.md`
Codebase scan: `docs/reference/codebase-scan-command-apostrophe-hotkey.md`

## Goal

Change the UI push-to-talk default to `Command+'` while keeping the hotkey editable through the existing UI field and preserving the existing system-wide press/release behavior.

## Approach

Reuse the current push-to-talk implementation. Extend the shared hotkey parser and global hook key-code mapping so the apostrophe key is supported explicitly, then update defaults, tests, and documentation.

## Files to Modify

- `src/ui/shared.ts`
- `src/ui/renderer/app.ts`
- `src/ui/hotkey.ts`
- `src/ui/globalHotkeyManager.ts`
- `tests/ui-hotkey.test.ts`
- `tests/ui-global-hotkey-manager.test.ts`
- `tests/ui-settings.test.ts`
- `README.md`
- `docs/tools/mic-tool-ts.md`
- `docs/design/project-functions.md`
- `docs/design/project-design.md`
- `Issues - Pending Items.md`

## Acceptance Criteria

- Default UI hotkey is `Command+'`.
- UI hotkey parsing accepts `Command+'`, `Command-'`, `Command+Quote`, and `Command+Apostrophe` as the same accelerator.
- System-wide native hook matching maps apostrophe to `Quote`.
- Focused tests and type checking pass.
