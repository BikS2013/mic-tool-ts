# Plan 017: UI Transcript Bubbles and Clear Action

Refined request: `docs/reference/refined-request-ui-transcript-bubbles-clear.md`
Codebase scan: `docs/reference/codebase-scan-ui-transcript-bubbles-clear.md`
Investigation: skipped — established Electron UI renderer pattern, no new external option.
Technical research: skipped — no new library or API.

## Objective

Make the Electron UI transcript area clearable and render each dictated turn as a grouped timeline entry: the raw dictated text bubble first, followed by processed output bubbles for that same turn in the order received.

## Implementation Steps

1. Update renderer markup with a compact clear-transcript control near the transcript/events monitor selector.
2. Replace the flat transcript item model in `src/ui/renderer/app.ts` with a renderer-local model that separates:
   - live partial text,
   - completed turn groups,
   - bubbles within each group.
3. Route `transcript.final` into the current turn group's raw bubble, merging consecutive finals for the same turn.
4. Route `transcript.refined` into the latest turn group as a processed bubble.
5. Treat `transcript.turnBoundary` as the explicit boundary after which the next final starts a new group.
6. Make the clear action remove turn groups, live partial text, and timeline count without stopping an active session.
7. Extend CSS so grouped bubbles remain width-constrained, readable, and mobile-safe.
8. Extend `test_scripts/verify-ui-bridge.cjs` to verify the clear control and grouped bubble layout.
9. Update `docs/design/project-functions.md` and `docs/design/project-design.md`.

## Files to Modify

- `src/ui/renderer/index.html`
- `src/ui/renderer/app.ts`
- `src/ui/renderer/styles.css`
- `test_scripts/verify-ui-bridge.cjs`
- `docs/design/project-functions.md`
- `docs/design/project-design.md`

## Acceptance Checks

- `pnpm run typecheck`
- `pnpm test`
- `pnpm run build`
- `pnpm exec electron test_scripts/verify-ui-bridge.cjs`


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
