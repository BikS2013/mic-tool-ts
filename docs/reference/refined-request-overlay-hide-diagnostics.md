# Refined Request: Overlay Hide Diagnostics

## Category

Development / Diagnostics

## Objective

Add focused diagnostics that can prove whether the hotkey transcription overlay disappears because the app receives a hotkey release, emits `capture.state: warm` or `idle`, or schedules an overlay hide while the user still believes dictation is active.

## Scope

In scope:

- Instrument UI push-to-talk press and release handling with the event source.
- Instrument `capture.state` transitions with the state reason and relevant hotkey/session booleans.
- Instrument overlay reducer actions, especially `schedule-hide` and `hide`, without logging transcript text.
- Gate new diagnostics behind the existing verbose configuration path.
- Add focused tests for diagnostic summary privacy and hotkey event-source reporting.

Out of scope:

- Changing overlay hide timing.
- Changing hotkey release semantics.
- Adding a new configuration variable or UI setting.
- Persisting diagnostics or transcript content.

## Requirements

1. Diagnostics MUST identify whether a press/release came from the native hook, Electron global shortcut, focused-window handler, renderer IPC fallback, settings-disable cleanup, or app blur cleanup.
2. Diagnostics MUST include `capture.state` state, reason, `sessionOwner`, `hotkeyPressed`, `hotkeySessionActive`, gate-open state, and warm recycle timer activity.
3. Overlay diagnostics MUST include the session event label, hotkey ownership, overlay action, visibility, phase, text-presence boolean, and hide delay when relevant.
4. Diagnostics MUST NOT include transcript text, processed text, API keys, provider endpoints, or other secret values.
5. Diagnostics MUST be visible only when verbose diagnostics are enabled through the existing `MIC_TOOL_TS_VERBOSE` configuration path or a resolved verbose UI session.

## Constraints

- Preserve current overlay visibility behavior.
- Preserve current hotkey press/release behavior.
- Avoid new dependencies.
- Avoid broad renderer changes.
- Use typed event delivery already used by the Electron UI.

## Acceptance Criteria

1. With verbose disabled, normal UI behavior is unchanged and the new diagnostic messages are not emitted.
2. With `MIC_TOOL_TS_VERBOSE=true`, hotkey press/release, capture transitions, and overlay show/hide/schedule-hide actions are visible as diagnostic info messages and stderr lines.
3. Diagnostic output contains no dictated transcript text.
4. Focused unit tests cover hotkey event-source reporting and overlay diagnostic privacy.
5. `pnpm run typecheck` and focused tests pass.

## Assumptions

- The current suspected issue is diagnostic first: the most likely cause is a false release or idle/warm transition, but the code should prove that before behavior changes are made.
- Verbose UI diagnostics may appear in the UI event stream and stderr; they do not need a separate log file.
- A future corrective change may be needed after a live run captures the exact transition sequence.

## Open Questions

- Does the live failure path show `hotkey.release`, `capture.state warm`, `capture.state idle`, or a provider/session error immediately before the overlay disappears?
- Is the event source native-hook, focused-window, renderer fallback, or global-shortcut-toggle when the unwanted transition occurs?

## Original Request

> Alright, I agree with your proposal for how you want us to proceed?
