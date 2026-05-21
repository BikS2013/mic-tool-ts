# Plan 018: UI Hotkey Warm Status

Refined request: `docs/reference/refined-request-ui-hotkey-warm-status.md`
Codebase scan: `docs/reference/codebase-scan-ui-hotkey-warm-status.md`
Investigation: skipped — existing warmed push-to-talk architecture is already established.
Technical research: skipped — no new external API or dependency.

## Objective

Make the UI state indicator distinguish warmed idle push-to-talk sessions from active recording.

## Steps

1. Add a typed `capture.state` UI event with `warm`, `recording`, and `idle` modes.
2. Emit `capture.state` from Electron main when the warmed session is ready, when the hotkey opens/closes the gate, and when the hotkey session stops.
3. Teach the renderer to parse `capture.state` and map it to `Warm / Ready`, `Recording`, or `Idle`.
4. Adjust button labels so warmed idle says `Stop Warm Session` instead of `Stop Listening`.
5. Add warmed/recording assertions to the Electron bridge verification.
6. Update function and design docs.

## Acceptance Checks

- `pnpm run typecheck`
- `pnpm test`
- `pnpm run build`
- `pnpm exec electron test_scripts/verify-ui-bridge.cjs`
