# Refined Request: Sidepanel Protocol Switches

## Category
Development / Electron UI behavior.

## Objective
Expose the four voice-agent protocol operator switches in the Electron UI right sidepanel and allow those switches to update the active protocol state while the UI is warmed, recording, or listening.

## Scope
In scope:
- Add right-side inspector controls for only the protocol operator switches: refine, translate, clipboard, and focused input.
- Keep non-switch protocol settings, including protocol mode, translation policy, LLM engine, LLM provider, and LLM model, out of the right sidepanel.
- Keep protocol switches enabled during active `running`, `warm`, and `recording` UI states.
- Persist accepted switch changes through the existing non-secret UI settings store.
- Apply switch changes to the active voice-agent protocol controller when a session is already running.
- Keep the existing spoken protocol commands and hotkey secondary-key toggles working.

Out of scope:
- Moving all Protocol view settings into the sidepanel.
- Changing the section-processing order or operator semantics.
- Changing translation policy, protocol mode, LLM provider, or model during an active session.
- Adding new dependencies.

## Requirements
- The right inspector MUST include switch controls for `refine`, `translate`, `clipboard`, and `focusedInput`/`input`.
- The inspector switches MUST stay synchronized with the existing Protocol view switches and with protocol `state.changed` events.
- Only protocol operator switches may remain editable during active `running`, `warm`, or `recording` states; other settings controls stay disabled as before.
- When a switch value changes during an active session, the active `VoiceAgentProtocolController` MUST receive the corresponding runtime state change before the next section submission.
- If no session is active, switch changes MUST update the next-session settings and persisted UI state.
- Invalid or unsupported protocol switch keys MUST be rejected rather than ignored silently.

## Constraints
- No secret values, transcript text, processed output, or protocol payloads may be persisted by this change.
- Runtime updates must use typed protocol state paths, not diagnostic text parsing.
- Existing manual Start/Stop and push-to-talk warm-session lifecycles must remain independent.
- The installed user-facing command remains `mic-tool-ts`.

## Acceptance Criteria
- The right inspector renders the four protocol operator switches and no other protocol settings.
- Toggling a sidepanel switch updates the matching Protocol view switch.
- Toggling a Protocol view switch updates the matching sidepanel switch.
- During `warm`, `recording`, and manual `running` states, protocol operator switches are enabled while non-protocol settings are disabled.
- During an active session, changing a switch emits a runtime `state.changed` protocol event and affects the active pending section.
- Focused UI/runtime tests, type checking, build, and the full test suite pass.

## Assumptions
- "Protocol switches" means the four operator booleans currently represented by `refine`, `translate`, `clipboard`, and `focusedInput` in renderer settings.
- "Warming" means the hotkey-owned `warm` state.
- "Listening" includes manual `running` and hotkey `recording` states.

## Open Questions
None.

## Original Request
> I want you to make the protocol switches (switches only, not the rest of the settings) available in the right sidepanel.
> I want you also to allow me to change them while in warming or listening mode.


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
