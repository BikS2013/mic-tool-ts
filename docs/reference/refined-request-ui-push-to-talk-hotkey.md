# Refined Request: UI Push-To-Talk Hotkey

## Category

Development.

## Objective

Add a configurable UI-mode hotkey combination that behaves as push-to-talk: pressing the hotkey starts microphone capture and live transcription, and releasing the hotkey stops capture and triggers the existing downstream processing pipeline for the captured transcript, including refinement, translation, clipboard, focused-input delivery, and JSONL/protocol event behavior where applicable.

## Scope

In scope:

- Add a configurable hotkey setting to the Electron UI.
- Make the hotkey available only through `mic-tool-ts ui`.
- Use hotkey press as the start signal for a short-lived capture/transcription session.
- Use hotkey release as the stop/finalize/process signal.
- Reuse the existing transcription, LLM refinement, protocol, clipboard, and focused-input pipeline.
- Preserve existing manual Start/Stop UI behavior unless push-to-talk is enabled.
- Persist or apply the hotkey through the existing UI runtime settings mechanism if that mechanism supports persisted UI settings; otherwise keep it as a UI runtime-only setting and document that behavior.
- Update project design, functional requirements, user-facing tool documentation, and tests.

Out of scope:

- Changing default CLI behavior outside UI mode.
- Adding a system tray app, login item, or background daemon.
- Adding new STT or LLM providers.
- Implementing cross-platform microphone capture beyond the existing project support.
- Replacing the existing spoken command protocol.

## Requirements

- The UI must expose a setting to enable or disable push-to-talk hotkey behavior.
- The UI must expose an editable hotkey combination using Electron-compatible accelerator text, such as `CommandOrControl+Shift+Space`.
- When the hotkey is pressed and no capture session is running, UI mode must start a capture session with the currently resolved UI settings.
- While the hotkey remains pressed, audio must be captured and transcribed through the existing provider flow.
- When the hotkey is released, UI mode must stop/finalize the session through the existing graceful shutdown path so final transcripts are drained and downstream processing runs after release.
- Repeated keydown events while the hotkey is held must not start duplicate sessions.
- Releasing the hotkey when no hotkey-started session is active must be a no-op.
- Manual Start/Stop must remain available and must not be accidentally stopped by a hotkey release unless that session was started by the hotkey.
- The implementation must not add hidden configuration fallbacks. If an explicitly supplied hotkey is invalid, the UI must report the validation error instead of substituting another combination.
- The implementation must avoid adding new runtime dependencies unless strictly necessary and vetted.

## Constraints

- The supported user-facing command remains `mic-tool-ts ui`.
- The project uses TypeScript and Electron.
- UI renderer code crosses the context-isolated preload IPC bridge and must keep settings typed.
- Required secrets must remain hidden from the renderer.
- The existing no-fallback configuration rule applies to any required configuration values.
- Existing transcript output stream separation rules remain unchanged.

## Acceptance Criteria

- The UI includes push-to-talk controls: enable/disable and hotkey combination.
- With push-to-talk enabled, pressing the configured hotkey starts listening and releasing it stops listening.
- Existing finalization and post-processing run after release, including refinement when enabled.
- Holding the hotkey does not create more than one active capture session.
- Manual Start/Stop behavior still works.
- Invalid hotkey settings are rejected with a visible UI error and do not register a shortcut.
- Tests cover hotkey settings validation and the press/release session lifecycle.
- `pnpm typecheck`, focused tests, and `pnpm build` pass.
- Design and function documentation describe the new UI push-to-talk behavior.

## Assumptions

- The hotkey is intended for the Electron UI window/runtime, not for the plain CLI.
- A default hotkey of `CommandOrControl+Shift+Space` is acceptable if no prior UI setting exists.
- The first implementation can use renderer-window keyboard events while the UI is focused if Electron does not provide reliable global key-release events for registered global shortcuts.
- Existing session finalization behavior is sufficient to trigger post-processing after hotkey release.

## Open Questions

- Should the hotkey work globally while another app is focused, or only while the Electron UI window is focused?
- Should the hotkey setting be persisted across UI restarts, or is session-local UI configuration acceptable for the first implementation?

## Original Request

> I want you to add aconfigurable hotkey combination/feature 
> that will capture and transcribe the voice while the hotkey is pressed, 
> and proceed with any further processing and use e.g. refinement transcription, etc., after the hotkey release. 
> So I want the hotkey to be used as the signal of starting voice capturing, and the hotkey release to be used as a signal for processing the captured, the transcribed content. 
> I want you to make it available upon the use of the UI feature.
