# Phase 7 — Code Review Report

**Reviewer**: Senior code reviewer (automated pass)
**Date**: 2026-05-16
**Scope**: `src/config.ts`, `src/errors.ts`, `src/mic/*`, `src/soniox/client.ts`, `src/render/renderer.ts`, `src/main.ts`, `src/index.ts`
**Inputs consulted**: `docs/design/refined-request-soniox-mic-transcriber.md` (AC-1..AC-14), `docs/design/project-design.md`, `docs/design/plan-001-soniox-mic-cli.md`, `Issues - Pending Items.md` (Phase 6 Unit Status).

---

## 1. Build & Typecheck

| Command | Result |
|---|---|
| `pnpm typecheck` (`tsc --noEmit`) | **PASS** — 0 errors, 0 warnings |
| `pnpm build` (`tsc -p .`) | **PASS** — `dist/` regenerated with `config.js`, `errors.js`, `main.js`, `index.js`, `mic/`, `render/`, `soniox/` |
| `pnpm audit --audit-level=high` | **PASS** — "No known vulnerabilities found" |

Both ran again successfully after the in-place fix described in §5.

---

## 2. Interface Integration

| Contract point | Status | Evidence |
|---|---|---|
| `main.ts` wires Unit C via `onPartial/onFinal/onError` setters | ✓ | `src/main.ts:155-160` calls `transcriber.onPartial(...)`, `.onFinal(...)`, `.onError(...)`; `src/soniox/client.ts:304-314` exposes those exact setters. Deviation from `project-design.md §3.3` (which proposed `start(callbacks)`) is documented in `Issues - Pending Items.md`. |
| `main.ts` constructs `StdoutRenderer({ mode, isTTY })` | ✓ | `src/main.ts:73-76`; `StdoutRenderer` constructor accepts `RendererOptions & { out?: ... }` at `src/render/renderer.ts:57`. |
| `createMicSource()` factory exists, Darwin-only | ✓ | `src/mic/index.ts:11-18` dispatches by `process.platform`; non-darwin throws `UnsupportedPlatformError`. |
| `mic.audio` is a `Readable` emitting `data` / `error` / `end` | ✓ | `src/mic/soxMicSource.ts:69,84-88` exposes a `PassThrough`; orchestrator listens for `data` (`src/main.ts:218`), `error` (`:219`), `end` (`:223`). |
| Cross-module `OutputMode` literal union | ✓ | Declared in `src/config.ts:45`; re-imported as `type OutputMode` in `src/render/renderer.ts:24`. Single source of truth. |
| Soniox session params match design §6 | ✓ | `src/soniox/client.ts:132-147`: `model: "stt-rt-v4"`, `audio_format: "pcm_s16le"`, `sample_rate: 16000`, `num_channels: 1`, `enable_endpoint_detection: true`, `connect_timeout_ms: 5000`. |

---

## 3. Acceptance-Criteria Coverage

| AC | Status | Evidence |
|---|---|---|
| **AC-1** Builds clean | ✓ | `pnpm build` zero errors; `pnpm audit --audit-level=high` zero advisories. |
| **AC-2** `--help` lists every flag | ✓ | `src/config.ts:197-225` defines `--api-key`, `--language`, `--output-mode`, `-v/--verbose`, `-h/--help`, `-V/--version`. Smoke test (§6) prints all flags + examples, exit 0. |
| **AC-3** `--version` prints semver, exits 0 | ✓ | `src/config.ts:97-103` + `:202`; smoke test prints `0.1.0`, exit 0. |
| **AC-4** Missing-key error | ✓ | `src/config.ts:333-337` raises `MissingConfigurationError` (exit 2). Smoke test confirms: stderr `missing_configuration: SONIOX_API_KEY is not set. ...`, exit 2. |
| **AC-5** Live transcription | needs-runtime | Static preconditions in place: `src/soniox/client.ts:333-389` wires `'result'` event, partial→final algorithm at `:392-420`. End-to-end run with real Soniox key deferred to Phase 10. |
| **AC-6** Partials render live | needs-runtime | Static preconditions: `src/render/renderer.ts:70-90` writes `\r`-overwritten partials in default mode; `client.ts:406-411` emits partial-buffer on every result containing non-final tokens. Phase 10. |
| **AC-7** Precedence honored | ✓ (static) | `src/config.ts:309-331` reads flag first, then `.env` via `readDotenv`, then `process.env`. `test_scripts/sanity-config.ts` exercises the full matrix per Phase 6 Unit A notes. |
| **AC-8** Graceful Ctrl+C | ✓ (static) | `src/main.ts:233-249` SIGINT handler invokes `shutdown(reason)`; teardown chain at `:108-146` is `mic.stop() → transcriber.stop() → renderer.dispose()`. `client.ts:234-300` shutdown bounded to ≤1500 ms via `FINISH_TIMEOUT_MS`. Force-quit on second SIGINT (`exit 130`) at `:234-238`. |
| **AC-9** Mic-permission error | ✓ (static) | `src/mic/soxMicSource.ts:282-313` classifies stderr tail; matches on `coreaudio+device`, `not allowed`, `permission`, `not authorized` → `MicPermissionDeniedError` (exit 3). Message at `:300-302` directs the user to System Settings. |
| **AC-10** Network-failure error | ✓ (static) | `connect_timeout_ms: 5000` at `client.ts:144` overrides SDK default 20000; `mapSdkError` (`:423-451`) maps `NetworkError`/`ConnectionError` → `SonioxNetworkError` (exit 5). Unsolicited mid-stream disconnect at `:372-389` → `onError(SonioxNetworkError)`. |
| **AC-11** Invalid-key error | ✓ (static) | `client.ts:428-432` maps `AuthError` → `SonioxAuthError` (exit 4). Both pre-connect event-channel and connect()-throw channels covered (`:149-187`). |
| **AC-12** Pipe-friendly stdout | ✓ | `src/render/renderer.ts:60-63` auto-downgrades `overwrite → append` when `isTTY === false`, regardless of whether the user passed `--output-mode overwrite` explicitly. `\r` never written to non-TTY. Verbose-mode logs go to stderr only (multiple sites). |
| **AC-13** Docs present | ✓ | `docs/design/project-design.md`, `docs/design/plan-001-soniox-mic-cli.md`, `docs/design/refined-request-soniox-mic-transcriber.md`, `docs/reference/investigation-soniox-mic-cli.md`, `README.md` (top-level), `Issues - Pending Items.md` all present. Configuration guide (`docs/design/configuration-guide.md`) not present — flagged below as minor. |
| **AC-14** Tests under `test_scripts/` | partial | Only Phase-6 sanity scripts exist (`sanity-config.ts`, `sanity-mic.ts`, `sanity-renderer.ts`). Plan §Phase 4 specifies `test-help.sh` / `test-version.sh` / `test-missing-key.sh` for AC-14 — to be produced by Phase 9 Test Builders. Logged in `Issues - Pending Items.md`. |

---

## 4. Quality Concerns

| Concern | Status |
|---|---|
| No-fallback configuration rule | **OK** — every missing/invalid setting raises `MissingConfigurationError` or `InvalidConfigurationError`. Documented defaults (`--language en`, `--output-mode overwrite`, `--verbose false`) are commander options, not silent fallbacks. |
| Soniox SDK error-class mapping completeness | **OK** — `client.ts:423-451` covers `AuthError`, `NetworkError`, `ConnectionError`, `BadRequestError`, `QuotaError`, `AbortError`, `StateError`, `RealtimeError`, and a generic `Error` catch-all (→ `SonioxProtocolError`). Confirmed against `node_modules/@soniox/node/dist/index.d.mts` exports. (`SonioxError`/`SonioxHttpError` apply only to the file/transcription HTTP API, not realtime — caught by the catch-all if ever encountered.) |
| Resource cleanup on every exit path | **OK** — `main.ts` calls `renderer.dispose()` in all three early-exit branches (transcriber-start failure, mic-factory failure, mic-start failure) and `transcriber.stop()` in the two post-transcriber-start branches. `shutdown()` runs the full three-step teardown. |
| No `any` in public interfaces | **OK** — `grep '\bany\b'` over `src/` returns 0 matches. |
| No `console.log` in production paths | **OK** — `grep 'console.log'` returns 0 matches. All diagnostics use `process.stderr.write`. |
| No `@ts-ignore` / `@ts-expect-error` | **OK** — 0 matches over `src/`. |
| No hardcoded API keys | **OK** — `grep -i 'api_key\|apikey' src/` returns only legitimate option/property references. |
| SIGINT graceful shutdown: second-Ctrl+C force-quit, `transcriberStarted`/`micStarted` flags, `shuttingDown` guard | **OK** — `main.ts:80-83` declares the flags, `:100-102` guards re-entry, `:234-238` handles force-quit (`process.exit(130)` after stderr `[mic-tool] force quit`), SIGTERM mirror at `:241-247` (`exit 143`). |

---

## 5. Issues Found and Fixed In-Place

### Fixed during this review

**[blocker on a narrow race] Temporal-dead-zone reference to `mic` in `shutdown` closure** — `src/main.ts` originally declared `let mic: MicSource | undefined;` at the original line 181, AFTER the `shutdown` closure at lines 100-147 that referenced it. The closure is captured immediately and is callable as soon as `transcriber.onError(...)` is registered at line 157. If a future SDK regression (or any code change that synchronously invokes the error callback during `transcriber.start()`) fired `onError` before line 181 ran, the deferred async IIFE inside `shutdown` would access `mic` in the temporal-dead zone and throw `ReferenceError: Cannot access 'mic' before initialization` — crashing the process at exactly the moment graceful teardown was supposed to begin.

**Fix**: Hoisted the `let mic: MicSource | undefined;` declaration to the shared-state block (above the `shutdown` closure) and removed the duplicate declaration at the original Step-5 site. Build, typecheck, and smoke tests rerun green.

Recorded under "Completed Items" in `Issues - Pending Items.md`.

### Newly logged (not fixed in this review)

- **AC-14 — `test_scripts/test-*.sh` shell scripts missing** (severity: minor). Owner: Phase 9 Test Builders. Logged in `Issues - Pending Items.md`.
- **`docs/design/configuration-guide.md` missing** (severity: minor). Project-conventions chapter requires it for any project with multiple config sources. Owner: Phase 8 (docs polish). Surfaced for visibility — not blocking Phase 7.
- **`StdoutRenderer.dispose()` write-after-teardown advisory** (severity: minor). Documented under Pending Items so a future change to a non-TTY-aware write path is forced to revisit it.

---

## 6. Smoke-Test Results

All executed from project root.

| Command | Expected | Observed | Pass |
|---|---|---|---|
| `pnpm dev --help` | exit 0, full usage block | exit 0, lists `--api-key`, `--language`, `--output-mode`, `-v/--verbose`, `-h/--help`, `-V/--version` + examples | ✓ |
| `pnpm dev --version` | exit 0, `0.1.0` | exit 0, prints `0.1.0` | ✓ |
| `env -u SONIOX_API_KEY pnpm dev` | exit 2, `MissingConfigurationError` on stderr | exit 2, stderr: `missing_configuration: SONIOX_API_KEY is not set. Provide via --api-key flag, .env file (SONIOX_API_KEY=...), or shell environment variable.` | ✓ |
| `pnpm dev --api-key ''` | exit 2 (empty string treated as missing) | exit 2, same `missing_configuration` message | ✓ |
| `pnpm dev --api-key abc --language XX` | exit 2 (`InvalidConfigurationError`) | exit 2, stderr: `invalid_configuration: --language must be 'auto' or an ISO 639-1/2 code (e.g. 'en', 'es', 'pt-BR'). Got: 'XX'.` | ✓ |
| `pnpm dev --api-key abc --output-mode invalid` | exit 2 | exit 2, stderr: `invalid_configuration: --output-mode must be one of: overwrite, append, final-only. Got: 'invalid'.` | ✓ |

---

## 7. Cross-File Consistency

- **Exit-code map** (`src/errors.ts:8-14` and `src/main.ts:50-51`) matches `project-design.md §8.5`: 0=SUCCESS, 1=UNKNOWN, 2=CONFIG, 3=MIC, 4=AUTH, 5=NETWORK, 6=PROTOCOL.
- **`OutputMode` literal union** declared once in `src/config.ts:45` and consumed as a type in `src/render/renderer.ts:24`.
- **Soniox session config** (`src/soniox/client.ts:132-147`) matches `project-design.md §6.1` verbatim — `stt-rt-v4`, `pcm_s16le`, 16 kHz, mono, endpoint-detection on, `connect_timeout_ms` 5000.

---

## 8. Recommendation

**READY for testing phase**, with the following follow-ups for downstream phases:

1. **Phase 9 (Test Builders)**: produce `test_scripts/test-help.sh`, `test-version.sh`, `test-missing-key.sh` (AC-14) and Vitest unit suites per the design's §10 test matrix.
2. **Phase 10 (Integration Verifier)**: run AC-5/AC-6/AC-7/AC-8/AC-9/AC-10/AC-11 on a real macOS host with a valid Soniox key and a microphone. Confirm AC-12 by piping `mic-tool > transcript.txt` in both default and `--output-mode append` modes.
3. **Phase 8 (Dependency Validator / docs polish)**: optionally add `docs/design/configuration-guide.md` per the project's "configuration-guide" convention.

No blockers remain in the implementation surface. The TDZ race uncovered during this review has been fixed in-place and re-verified.
