# Refined Request: System-Wide Command-Backtick Push-To-Talk Hotkey

## Category

Development.

## Objective

Change the UI push-to-talk default hotkey to `Command+\`` and make push-to-talk system-wide so the user can press and hold the hotkey from any focused macOS application while `mic-tool-ts ui` is running.

## Scope

In scope:

- Change the default UI push-to-talk accelerator from `CommandOrControl+Shift+Space` to `Command+\``.
- Add system-wide keydown and keyup detection for the configured UI hotkey.
- Preserve the existing press-to-start and release-to-stop behavior.
- Preserve the existing release-time pending-section submission to the protocol/refinement pipeline.
- Keep the feature available through `mic-tool-ts ui`; the plain CLI remains unchanged.
- Keep manual Start/Stop behavior independent.
- Add dependency vetting, tests, and documentation for the native global hook.

Out of scope:

- Building a login item, tray/background daemon, or packaging/signing workflow.
- Adding new STT or LLM providers.
- Changing microphone capture backends.
- Guaranteeing suppression of the underlying macOS/app behavior for `Command+\``; the hotkey is observed system-wide for push-to-talk.

## Requirements

- The UI's default hotkey value must be `Command+\``.
- The global hotkey must be configurable through the existing UI hotkey field.
- When push-to-talk is enabled, pressing the configured hotkey while any app is focused must start a UI-owned capture session if no session is already active.
- Releasing the configured hotkey while any app is focused must stop the hotkey-owned session with `submitPending: true`.
- Holding the hotkey must not start duplicate sessions.
- Releasing the hotkey must not stop a manually started session.
- If the native global hook cannot start because macOS permissions are missing or the native module fails, the UI must emit a visible warning and retain the existing focused-window fallback.
- Required configuration values must still raise typed errors; no hidden configuration fallbacks are allowed.
- Any new runtime dependency must be vetted, pinned, installed, audited, and documented in `Issues - Pending Items.md`.

## Constraints

- This project is TypeScript-first and Electron-based.
- The UI renderer remains sandboxed and context-isolated.
- Native key event hooks on macOS may require Accessibility/Input Monitoring permissions for the app that launched Electron.
- `Command+\`` may also be used by macOS or the frontmost app for window cycling; this implementation observes the shortcut and does not promise to block that behavior.

## Acceptance Criteria

- `DEFAULT_RENDERER_SETTINGS.hotkey` is `Command+\``.
- UI settings normalization accepts `Command+\`` and renders it canonically.
- A system-wide keydown event matching the configured hotkey starts the session.
- A system-wide keyup event matching the configured hotkey stops the hotkey-owned session with pending submission.
- Global hook startup failures produce a diagnostic warning instead of crashing UI mode.
- Focused-window hotkey handling still works as a fallback.
- Tests cover default hotkey normalization and global hotkey manager behavior.
- `pnpm typecheck`, focused tests, full tests, `pnpm build`, and `pnpm audit --audit-level=high` pass.

## Assumptions

- macOS is the primary target for this feature, matching the current microphone and UI support.
- Adding a native hook dependency is acceptable because Electron's built-in `globalShortcut` does not provide key release events.
- `Command+\`` means the Command modifier plus the backquote/backtick key on a US keyboard layout.

## Open Questions

- Whether the user's macOS environment grants the necessary Accessibility/Input Monitoring permission to the app that launches `mic-tool-ts ui`.
- Whether `Command+\`` conflicts with the user's frontmost app behavior in a way that feels disruptive.

## Original Request

> I want you to change the hotkey to Command-`
> And I want you to make it system-wide, not needed to focus the UI window to activate it.
