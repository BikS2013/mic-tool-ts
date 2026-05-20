# Refined Request: Command-Apostrophe UI Hotkey

## Category
Development / UI configuration.

## Objective
Change the UI push-to-talk default hotkey to `Command+'` and ensure it remains configurable through the existing Electron UI hotkey field.

## Scope
In scope:
- Update the default UI hotkey from `Command+\`` to `Command+'`.
- Ensure focused-window and system-wide hotkey matching both support the apostrophe/quote key.
- Preserve the existing UI enable/disable and editable hotkey controls.
- Update focused tests and user-facing documentation that describe the default hotkey.

Out of scope:
- Adding a persistent preferences store for UI hotkey settings.
- Changing the push-to-talk start/stop/session lifecycle.
- Suppressing any frontmost-app or macOS behavior bound to `Command+'`.

## Requirements
- `DEFAULT_RENDERER_SETTINGS.hotkey` must be `Command+'`.
- The renderer demo/default settings must also use `Command+'`.
- The shared hotkey parser must normalize common apostrophe key aliases to `Command+'`.
- The native global hotkey manager must map the parsed apostrophe key to the native hook `Quote` key code.
- The existing UI hotkey text input must remain the user-facing configuration mechanism.
- Invalid hotkey values must continue to be rejected rather than replaced with hidden fallbacks.

## Constraints
- No new runtime dependency is required.
- Configuration values must not gain hidden defaults outside the documented UI default.
- Keep manual Start/Stop behavior independent from hotkey-owned sessions.

## Acceptance Criteria
- Tests prove `Command+'`, `Command-'`, `Command+Quote`, and `Command+Apostrophe` normalize to `Command+'`.
- Tests prove global `Command+'` keydown starts once and keyup releases once.
- Tests prove the default UI hotkey is `Command+'`.
- `pnpm typecheck` and focused hotkey/settings tests pass.
- README, tool docs, project functions, and project design describe the new default.

## Assumptions
- `Command+'` means the macOS Command modifier plus the apostrophe/single-quote key on a US-style keyboard layout.
- The system-wide behavior implemented for the previous hotkey remains correct and should be reused.

## Open Questions
None.

## Original Request
> I want to change the hotkey to command+' and make it configurable through the UI.
