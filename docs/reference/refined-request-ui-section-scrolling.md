# Refined Request: UI Section Scrolling

## Category
Development / UI layout.

## Objective
Add scrolling support to every major Electron UI section so content remains reachable when it exceeds the available window size horizontally or vertically.

## Scope
In scope:
- Add bounded vertical and horizontal scrolling to the UI's main content panels.
- Ensure settings, protocol, logs, transcript, sidebar, inspector, toolbar, and capture bar content remains reachable when the window is small or content is long.
- Preserve the existing visual direction, view switching, controls, and typed renderer behavior.
- Update design/function documentation for the new UI overflow behavior.

Out of scope:
- Redesigning the Electron UI.
- Adding new UI controls or changing transcription/session behavior.
- Adding new runtime dependencies.

## Requirements
- Active view panels must allow vertical scrolling when their content is taller than the available content area.
- Active view panels must allow horizontal scrolling when their content is wider than the available content area.
- Sidebar and inspector content must remain independently scrollable.
- Toolbar and capture bar overflow must remain reachable horizontally instead of clipping controls.
- Existing transcript auto-scroll behavior must continue to work.
- Scrollbars must be local to sections and must not make the whole body page scroll.

## Constraints
- Implement with CSS/layout changes unless the code proves JavaScript is required.
- Preserve the Electron renderer security model and local packaged asset flow.
- Keep the macOS visual style and compact layout intact.

## Acceptance Criteria
- Settings, protocol, logs, and transcript views each have their own scroll containment.
- Sidebar, inspector, toolbar, and capture bar no longer permanently clip overflowed content.
- `pnpm typecheck`, focused UI tests, `pnpm build`, and `pnpm test` pass.
- Documentation records the UI overflow/scrolling behavior.

## Assumptions
- "All sections" refers to the existing visible UI regions rather than adding new logical pages.
- Horizontal scrolling is acceptable where content cannot reasonably wrap without making controls unusable.

## Open Questions
None.

## Original Request
> I want you to add scrolling capabilities for all the sections on the UI to support cases where the content exceeds the window size, either horizontally or vertically.


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
