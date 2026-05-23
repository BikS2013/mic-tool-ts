---
status: completed
mode: write-and-run
scope_slug: soniox-mic-orchestrator
language: TypeScript
framework: vitest
test_command_full: pnpm test
test_command_scope: npx vitest run tests/mic.test.ts tests/soniox-client.test.ts tests/main.test.ts
test_dir: tests/
target_path: /Users/giorgosmarinos/aiwork/coding-platform/mic-tool-ts
test_files_owned:
  - tests/mic.test.ts
  - tests/soniox-client.test.ts
  - tests/main.test.ts
tests_added: 53
tests_updated: 0
tests_run: 53
tests_passed: 53
tests_failed: 0
implementation_gaps: 0
built_at: 2026-05-16T00:26:00Z
last_built_commit: null
---

# Test Build — Soniox Mic Orchestrator (Units B, C, E)

## 1. Summary

All 53 new tests pass across three new test files covering Unit B (mic source), Unit C (Soniox client), and Unit E (orchestrator). The full suite of 143 tests (including pre-existing tests in `errors.test.ts`, `renderer.test.ts`, and `config.test.ts`) also passes cleanly with zero errors or warnings. No implementation gaps were discovered. No shared infrastructure changes were required.

## 2. Scope Resolved

**src/mic/index.ts** — `createMicSource()`
- Platform dispatch: darwin → `SoxMicSource`; other → `UnsupportedPlatformError`

**src/mic/soxMicSource.ts** — `SoxMicSource`
- `start()` — grace-window resolution, locked argv, stdout piping
- Error mapping: ENOENT → `MicNotAvailableError`; permission stderr → `MicPermissionDeniedError`; no-device stderr → `MicNotAvailableError`
- Mid-stream unexpected exit → `'error'` event on audio stream
- `stop()` — SIGTERM, SIGKILL fallback, idempotent, no-op on idle

**src/soniox/client.ts** — `SonioxTranscriber`
- `start()` — SDK connect, error mapping (AuthError → SonioxAuthError, NetworkError/ConnectionError → SonioxNetworkError)
- `pushAudio()` — forwarding when connected, silent drop when not
- Token / result handling — `<end>`/`<fin>` filter, partial accumulation, final commit + trim, buffer reset
- Unsolicited `'disconnected'` event → `onError(SonioxNetworkError)`
- `stop()` — finalize → finish sequence, 1500 ms timeout fallback to close(), idempotent

**src/main.ts** — `main(argv)`
- Happy path end-to-end wiring
- Config failure paths (HelpOrVersionShown → 0, MissingConfigurationError → 2)
- Soniox start failures (SonioxAuthError → 4, SonioxNetworkError → 5)
- Mic start failure after Soniox connected → transcriber.stop() called, → 3
- Async transcriber error during session → shutdown → exit code from error
- Mic audio error during session → shutdown → exit code from error
- SIGINT → graceful shutdown → 0
- Second SIGINT during shutdown → process.exit(130)
- Idempotent shutdown: two concurrent event-channel triggers → single teardown sequence

## 3. Existing Coverage

No existing tests covered any of the in-scope symbols before this build:

| Symbol | Previously covered by |
|---|---|
| `createMicSource` | None |
| `SoxMicSource` | None (manual sanity script only: `test_scripts/sanity-mic.ts`) |
| `SonioxTranscriber` | None |
| `main` | None (manual smoke tests only) |

## 4. Plan (implemented as written)

| # | target_symbol | category | test_file | test_name | intent |
|---|---|---|---|---|---|
| 1 | `SoxMicSource.start` | unit | mic.test.ts | resolves after 200 ms grace window | Proves start() resolves once the child survives the grace period |
| 2 | `SoxMicSource.start` | unit | mic.test.ts | spawns sox with locked argv | Verifies the exact argv sent to spawn() |
| 3 | `SoxMicSource.start` | unit | mic.test.ts | audio stream receives data from stdout | Proves stdout is piped through to the public audio stream |
| 4 | `SoxMicSource.start` | error_path | mic.test.ts | ENOENT → MicNotAvailableError | Verifies sox-not-installed maps to the correct error type |
| 5 | `SoxMicSource.start` | error_path | mic.test.ts | permission stderr → MicPermissionDeniedError (×3) | Verifies all three permission-related stderr patterns |
| 6 | `SoxMicSource.start` | error_path | mic.test.ts | no-device stderr → MicNotAvailableError (×2) | Verifies "no default audio device" and "can't open" patterns |
| 7 | `SoxMicSource` | error_path | mic.test.ts | mid-stream unexpected exit → error on audio | Proves unexpected post-start exit emits MicNotAvailableError |
| 8 | `SoxMicSource.stop` | unit | mic.test.ts | sends SIGTERM on stop | Verifies SIGTERM is the first kill signal |
| 9 | `SoxMicSource.stop` | unit | mic.test.ts | SIGKILL fallback after 500 ms | Verifies SIGKILL fires if SIGTERM is unacknowledged |
| 10 | `SoxMicSource.stop` | unit | mic.test.ts | idempotent stop | Proves double-stop resolves both and sends SIGTERM once |
| 11 | `SoxMicSource.stop` | unit | mic.test.ts | no-op on idle | stop() on unstarted mic resolves without error |
| 12 | `SoxMicSource.start` | unit | mic.test.ts | double start rejection | Second start() throws a plain Error |
| 13 | `createMicSource` | unit | mic.test.ts | darwin returns SoxMicSource | Platform dispatch for darwin |
| 14 | `createMicSource` | unit | mic.test.ts | linux throws UnsupportedPlatformError | Platform dispatch for linux |
| 15 | `createMicSource` | unit | mic.test.ts | win32 throws UnsupportedPlatformError | Platform dispatch for win32 |
| 16 | `SonioxTranscriber.start` | unit | soniox-client.test.ts | connects and marks state | Proves connect() is called and state becomes "connected" |
| 17 | `SonioxTranscriber.start` | unit | soniox-client.test.ts | double start rejects | Second start() rejects with SonioxProtocolError |
| 18 | `SonioxTranscriber.start` | error_path | soniox-client.test.ts | AuthError → SonioxAuthError | SDK AuthError maps to SonioxAuthError |
| 19 | `SonioxTranscriber.start` | error_path | soniox-client.test.ts | NetworkError → SonioxNetworkError | SDK NetworkError maps to SonioxNetworkError |
| 20 | `SonioxTranscriber.start` | error_path | soniox-client.test.ts | ConnectionError → SonioxNetworkError | SDK ConnectionError maps to SonioxNetworkError |
| 21 | `SonioxTranscriber.pushAudio` | unit | soniox-client.test.ts | forwards when connected | Audio is sent to session.sendAudio() |
| 22 | `SonioxTranscriber.pushAudio` | unit | soniox-client.test.ts | drops when not started | pushAudio() does not throw before start() |
| 23 | `SonioxTranscriber.pushAudio` | unit | soniox-client.test.ts | drops when state != connected | Audio is silently dropped in non-connected states |
| 24 | `SonioxTranscriber` | unit | soniox-client.test.ts | <end> filter | <end> marker tokens do not trigger onFinal or onPartial |
| 25 | `SonioxTranscriber` | unit | soniox-client.test.ts | <fin> filter | <fin> marker tokens do not trigger onFinal |
| 26 | `SonioxTranscriber` | unit | soniox-client.test.ts | partial accumulation | Non-final tokens accumulate and call onPartial |
| 27 | `SonioxTranscriber` | unit | soniox-client.test.ts | final commit + trim | Final tokens commit partialBuffer and trim the result |
| 28 | `SonioxTranscriber` | unit | soniox-client.test.ts | trim whitespace | Leading/trailing whitespace is trimmed from finals |
| 29 | `SonioxTranscriber` | unit | soniox-client.test.ts | no partial when only finals | onPartial not called when no non-final tokens |
| 30 | `SonioxTranscriber` | unit | soniox-client.test.ts | buffer reset after final | partialBuffer resets after commit |
| 31 | `SonioxTranscriber` | unit | soniox-client.test.ts | unsolicited disconnect → onError | Unexpected disconnect calls onError(SonioxNetworkError) |
| 32 | `SonioxTranscriber` | unit | soniox-client.test.ts | no error after stop | disconnect after stop() is suppressed |
| 33 | `SonioxTranscriber.stop` | unit | soniox-client.test.ts | finalize then finish | finalize() and finish() called in order |
| 34 | `SonioxTranscriber.stop` | unit | soniox-client.test.ts | timeout fallback to close | close() called when finish() exceeds 1500 ms |
| 35 | `SonioxTranscriber.stop` | unit | soniox-client.test.ts | idempotent stop | Double stop() only finalizes once |
| 36 | `SonioxTranscriber.stop` | unit | soniox-client.test.ts | stop when never started | stop() resolves when start() was never called |
| 37 | `main` | integration | main.test.ts | happy path end-to-end | All steps wire correctly, returns 0 on clean shutdown |
| 38 | `main` | integration | main.test.ts | partial and final forwarded | onPartial/onFinal callbacks reach the renderer |
| 39 | `main` | integration | main.test.ts | data event wired | mic.audio 'data' listener is installed |
| 40 | `main` | integration | main.test.ts | HelpOrVersionShown → 0 | Help/version exits return 0 without starting subsystems |
| 41 | `main` | integration | main.test.ts | MissingConfigurationError → 2 | Missing config returns 2 without starting subsystems |
| 42 | `main` | integration | main.test.ts | SonioxAuthError → 4 | Auth failure returns 4 and disposes renderer |
| 43 | `main` | integration | main.test.ts | SonioxNetworkError → 5 | Network failure returns 5 |
| 44 | `main` | integration | main.test.ts | mic start fail → transcriber.stop | transcriber.stop() called when mic.start() fails |
| 45 | `main` | integration | main.test.ts | mic permission denied → 3 | MicPermissionDeniedError returns 3 |
| 46 | `main` | integration | main.test.ts | transcriber mid-stream error → shutdown | onError callback triggers shutdown |
| 47 | `main` | integration | main.test.ts | mic audio error → shutdown | Audio stream error triggers shutdown |
| 48 | `main` | integration | main.test.ts | SIGINT → clean shutdown → 0 | First SIGINT runs full teardown and returns 0 |
| 49 | `main` | integration | main.test.ts | second SIGINT → process.exit(130) | Second SIGINT during in-flight shutdown calls process.exit(130) |
| 50 | `main` | integration | main.test.ts | idempotent shutdown | Two concurrent shutdown triggers produce a single teardown sequence |

## 5. Files Owned

| File | Reason |
|---|---|
| `tests/mic.test.ts` | New — Unit B (SoxMicSource + createMicSource factory) |
| `tests/soniox-client.test.ts` | New — Unit C (SonioxTranscriber) |
| `tests/main.test.ts` | New — Unit E (Orchestrator) |

## 6. Test Run Results

All 53 tests in scope passed. Full suite of 143 tests also passed.

Command run:
```
npx vitest run tests/mic.test.ts tests/soniox-client.test.ts tests/main.test.ts
```

```
Test Files  3 passed (3)
     Tests  53 passed (53)
  Start at  00:26:xx
  Duration  ~130ms
```

No failures.

## 7. Implementation Gaps

None discovered.

## 8. Manual Review Needed

**Async unhandled-rejection warnings (vitest internal — cosmetic only):**

During earlier iteration, vitest v4.1.6 emitted `PromiseRejectionHandledWarning` entries when fake-timer callbacks created Promise rejections that vitest's own internal `setImmediate`-based tick processing handled before the test's microtask chain. This was resolved by:
1. Using `makeRejectionCollector()` pattern in `mic.test.ts` to attach `.catch()` synchronously before any timer advance.
2. Converting fake child scheduling from `setImmediate()` to `Promise.resolve().then()` to keep callbacks in the microtask queue.

The final test run produces **zero warnings**.

**Note on `soniox-client.test.ts` error-mapping approach:**

The `SonioxTranscriber.start()` error-mapping tests require the mock session's `connect()` to throw. Because the `connect()` method is called synchronously inside `start()` (as part of `await session.connect()`), patching cannot happen via a deferred microtask. The solution was to check a `globalThis.__nextConnectError` flag inside the mock's `connect()` implementation, which tests set pre-emptively before calling `makeTranscriber()` / `start()`.

This pattern is entirely contained in `tests/soniox-client.test.ts` and requires no changes to shared test infrastructure.

## 9. Commands Run

| # | Command | Exit code |
|---|---|---|
| 1 | `npx vitest run tests/mic.test.ts --reporter=verbose` | 0 (18/18 passing) |
| 2 | `npx vitest run tests/soniox-client.test.ts --reporter=verbose` | 0 (21/21 passing) |
| 3 | `npx vitest run tests/main.test.ts --reporter=verbose` | 0 (14/14 passing) |
| 4 | `npx vitest run --reporter=verbose` (full suite) | 0 (143/143 passing) |


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
