---
language: TypeScript
framework: Electron main + shared session runner
package_manager: pnpm
build_command: pnpm run build
test_command: pnpm test
lint_command: null
entry_points:
  - src/ui/electronMain.ts
  - src/core/sessionRunner.ts
last_scanned_commit: 207979f
request_file: docs/reference/refined-request-recycle-warm-session.md
scan_scope: request-driven push-to-talk warm-session recycle lifecycle
generated_at: 2026-05-21T04:38:44Z
---

# Codebase Scan: Recycle Warm Session

## Module Map

- `src/ui/electronMain.ts` owns push-to-talk warm session state, opens/closes the `HotkeySessionControl` audio gate, starts/stops UI sessions, and emits typed capture-state events.
- `src/core/sessionRunner.ts` owns the actual mic/transcriber lifecycle and shuts down mic, transcriber, renderer, submit-pending listeners, and abort listeners through the existing shutdown path.
- `src/mic/soxMicSource.ts` stops the `sox` child process with a SIGTERM/SIGKILL fallback.
- `src/ui/renderer/app.ts` displays the typed warm/recording status but should not own recycle scheduling.
- `test_scripts/verify-ui-bridge.cjs` verifies packaged renderer behavior; lifecycle recycle is best covered by type/build plus deterministic code path checks unless a shorter injectable timeout is introduced.

## Integration Points

### In-Scope

- `src/ui/electronMain.ts`
  - Add a fixed five-minute warm recycle timer.
  - Schedule it from `capture.state: warm`.
  - Clear it from `capture.state: recording` and `capture.state: idle`.
  - On timeout, set `restartWarmSessionAfterStop`, stop the current hotkey-owned session, and let the existing `.then()` restart path call `reconcileHotkeyWarmSession()`.

- `docs/design/project-functions.md`
  - Add the warm-session recycle requirement.

- `docs/design/project-design.md`
  - Document the timer and restart lifecycle.

- `Issues - Pending Items.md`
  - Record the issue and solution.

### Out-of-Scope

- Provider clients.
- Manual session lifecycle.
- Renderer visual changes beyond existing status events.

## Duplication Check

There is no existing warm-session recycle timer. The existing restart path for settings changes (`restartWarmSessionAfterStop`) can be reused so recycle does not need a parallel session-management implementation.
