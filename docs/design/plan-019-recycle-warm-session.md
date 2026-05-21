# Plan 019: Recycle Warm Push-to-Talk Session

Refined request: `docs/reference/refined-request-recycle-warm-session.md`
Codebase scan: `docs/reference/codebase-scan-recycle-warm-session.md`
Investigation: skipped — existing warm-session architecture provides a single clear implementation path.
Technical research: skipped — no external API or dependency.

## Objective

Restart a hotkey-owned warmed idle session after five continuous minutes in `Warm / Ready` state.

## Steps

1. Add a five-minute timer constant and timer state to Electron main.
2. Schedule the timer only from typed `capture.state: warm`.
3. Clear the timer when capture state changes to `recording` or `idle`.
4. On timeout, verify the session is still hotkey-owned, warm, and push-to-talk is still enabled.
5. Set `restartWarmSessionAfterStop`, stop the current warm session, and rely on the existing restart path to create a fresh one.
6. Emit diagnostic/status events for recycle start.
7. Update documentation and issue log.
8. Run `pnpm run typecheck`, `pnpm test`, `pnpm run build`, and `pnpm exec electron test_scripts/verify-ui-bridge.cjs`.
