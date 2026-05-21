# Refined Request: UI Transcript Bubbles and Clear Action

## Category

Development

## Objective

Update the `mic-tool-ts ui` transcript area so a user can clear the visible transcript history, and so each dictated turn is displayed as a grouped sequence of bubbles: the raw dictated text first, followed by each processed result for that same turn such as refined text, translated text, and later refinements or translations.

## Scope

In scope:

- Add a visible clear action for the UI transcript area.
- Change the UI transcript rendering model so final dictated text from one turn is collected into one raw transcript bubble instead of scattered across separate visual entries.
- Render processed outputs for that turn as subsequent bubbles in chronological pipeline order.
- Preserve live partial transcript display while a turn is still being dictated.
- Keep the implementation inside the existing Electron UI renderer/session event flow and avoid new runtime dependencies.
- Update project design/function documentation for the UI behavior change.
- Add or update focused verification for the renderer behavior.

Out of scope:

- Changing the CLI stdout renderer behavior.
- Changing STT, LLM, translation, clipboard, or focused-input processing semantics.
- Persisting transcript history across app restarts.
- Adding new transcript export, search, or editing features.

## Requirements

- The transcript area MUST expose a clear button or icon button that removes all visible transcript timeline entries and live partial text from the UI.
- Clearing the transcript MUST be local to the renderer display; it MUST NOT stop an active listening session or modify protocol/operator settings.
- Final dictated text belonging to the same submitted/closed turn MUST be grouped into one raw text bubble.
- Processed results for the same turn MUST render as separate follow-up bubbles in the order received.
- When multiple processing stages occur for one turn, the UI MUST keep them visually associated with that turn instead of interleaving them as unrelated top-level entries.
- Live partial text MUST remain visible during dictation and should be cleared or committed appropriately when the final turn bubble is created.
- Existing transcript/status/event views MUST continue to render without layout overflow in normal desktop windows.

## Constraints

- Use existing project patterns in `src/ui/renderer/` and the shared UI event types.
- Do not add runtime dependencies.
- Do not create fallback behavior for required configuration.
- Preserve the supported user-facing invocation as `mic-tool-ts`.
- Any new test script, if needed, must be placed under `test_scripts/`.

## Acceptance Criteria

- A user can click the transcript clear action and the visible transcript area becomes empty.
- Dictating a turn creates one bubble containing the dictated text for that turn.
- Refined and translated results for that turn appear as subsequent bubbles tied to the same grouped timeline entry.
- Clearing the transcript during or after a session does not stop capture or change settings.
- Renderer verification covers clear behavior and grouped raw/processed transcript display.
- Type checking and relevant tests pass.

## Assumptions

- “Turn” maps to the existing UI session’s section/turn lifecycle events rather than a new STT-level segmentation concept.
- The bubble grouping is a UI presentation change; underlying protocol events remain unchanged.
- Processed result events already contain enough timing/order information to associate them with the latest submitted turn in the renderer.

## Open Questions

None blocking.

## Original Request

> I want you to add a button to clear the transcript area in the tool 
> I want you to collect all the dictated text from a turn into a bubble 
> so I want a bubble with the text i dictate, the bubble with the refined/translated version after, the other translated text after, the other refined version after etc ...
