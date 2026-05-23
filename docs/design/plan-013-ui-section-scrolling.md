# Plan 013: UI Section Scrolling

Refined request: `docs/reference/refined-request-ui-section-scrolling.md`
Codebase scan: `docs/reference/codebase-scan-ui-section-scrolling.md`

## Goal

Make every major Electron UI section independently scrollable when content exceeds the window size horizontally or vertically.

## Approach

Use CSS containment and overflow rules on the existing layout regions. Keep the body/app shell fixed to the Electron window, then make toolbar, sidebar, active view panels, inspector, and capture bar handle their own overflow.

## Files to Modify

- `src/ui/renderer/styles.css`
- `docs/design/project-functions.md`
- `docs/design/project-design.md`
- `Issues - Pending Items.md`

## Acceptance Criteria

- Main view panels scroll vertically and horizontally when necessary.
- Sidebar and inspector scroll independently.
- Toolbar and capture bar do not permanently clip overflowed controls.
- Existing UI behavior tests, type checking, build, and full test suite pass.


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
