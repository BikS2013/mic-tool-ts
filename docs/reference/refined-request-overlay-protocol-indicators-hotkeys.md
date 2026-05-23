# Refined Request: Overlay Protocol Indicators And Hotkeys

## Category
Development

## Objective
Add compact protocol-feature indicators to the independent transcription overlay and let users toggle those protocol features with secondary keys while the dictation push-to-talk hotkey is held.

## Scope
- In scope:
  - Extend the bottom overlay to show whether `refine`, `translate`, `clipboard`, and `input` protocol operators are enabled.
  - Add runtime hotkey toggles while the push-to-talk hotkey is held.
  - Keep the overlay indicators synchronized with protocol state changes from spoken protocol commands and the new hotkeys.
  - Preserve the existing independent overlay window, warmed push-to-talk session, and session-event pipeline.
  - Add focused unit coverage and update project design/function documentation.
- Out of scope:
  - New STT, LLM, clipboard, or focused-input implementations.
  - New dependencies.
  - Changing the user-facing command invocation.
  - Persisting transcript text, processed output, protocol event payloads, API keys, or provider endpoints.

## Requirements
1. The overlay MUST show four small bottom indicators for refinement, translation, copy-to-clipboard, and focused-input delivery.
2. The indicators MUST show enabled/disabled state in a compact, stable layout that does not resize or obscure the live transcript text.
3. The indicators MUST be driven by typed UI/protocol state, not by parsing rendered text.
4. While the push-to-talk dictation hotkey is held, pressing `R`, `T`, `C`, or `I` MUST toggle `refine`, `translate`, `clipboard`, or `input` respectively.
5. The toggle hotkeys MUST work through the system-wide native hook when available and through the focused-window renderer fallback when the Electron window has focus.
6. Runtime toggles MUST affect the currently active hotkey-owned protocol controller so the pending dictated section uses the updated operator state when released/submitted.
7. Runtime toggles MUST emit normal `protocol.event` / `state.changed` events so the main UI and overlay stay synchronized.
8. Existing spoken protocol commands such as `command refine` and `command input off` MUST also update the overlay indicators.
9. Missing native hook permissions MUST retain the existing focused-window fallback behavior.
10. No new hidden configuration fallbacks or secret persistence may be introduced.

## Constraints
- The project is a TypeScript Electron CLI application.
- The overlay renderer is sandboxed and context-isolated through the existing preload bridge.
- Existing operator names are `refine`, `translate`, `clipboard`, and `input`; the user wording "transcription" is treated as "translation" because there is no protocol operator named transcription.
- UI settings persistence may store non-secret preferences, but transcript text and processed output must remain volatile.
- The user-facing invocation remains `mic-tool-ts` and `mic-tool-ts ui`.

## Acceptance Criteria
1. The overlay visibly includes enabled/disabled indicators for the four protocol operators.
2. Holding the dictation hotkey and pressing `R`, `T`, `C`, or `I` toggles the matching protocol operator during a push-to-talk session.
3. Toggle events update the active protocol controller and produce `state.changed` protocol events.
4. Overlay indicators update after both hotkey toggles and spoken protocol state commands.
5. Focused-window fallback hotkey handling supports the same secondary toggles.
6. Existing overlay show/hide behavior and transcript rendering continue to work.
7. Type checking and tests pass.

## Assumptions
- The secondary key mapping is `R=refine`, `T=translate`, `C=clipboard`, and `I=input`.
- The indicators only need to be visible while the overlay itself is visible.
- The "transcription" item in the request refers to the existing `translate` protocol operator.

## Open Questions
- Should future versions make the secondary key mapping configurable?
- Should the overlay include explicit key hints for the secondary toggles beyond the indicator labels?

## Original Request
Nice, now I want you to add small indicators to the overlay at the bottom that show whether refinement, transcription, copy to clipboard, and input in the active control are enabled.
Also, I  want you to enable hotkeys that allow the user, while holding down the dictation hotkey, to enable or disable these protocol features.


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
