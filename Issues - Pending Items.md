# Issues — Pending Items

This file tracks open issues, pending follow-ups, and dependency-vetting decisions for the `mic-tool` project. Pending items are listed first (most critical at the top), followed by completed items, followed by the dependency-vetting log.

## Pending Items

- **Implement the other seven LLM providers** (severity: feature gap; plan-003 v2) — `openai`, `anthropic`, `google`, `azure-ai-inference`, `ollama`, `litellm`, `openai-compat`. All seven are accepted by config validation but throw `LLMConfigurationError` at refiner construction via `src/llm/factory.ts`. Each needs its own `<provider>.ts` adapter under `src/llm/`, wiring in `factory.ts`, and provider-specific env-var resolution in `resolveProviderConfig()` (`src/config.ts`). The error messages already document the env vars each provider expects (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `AZURE_AI_INFERENCE_*`, `OLLAMA_HOST`, `LITELLM_*`, `OPENAI_COMPAT_*`).

- **Add `AZURE_OPENAI_API_KEY_EXPIRES_AT` support in code** (severity: medium) — Per CLAUDE.md `<configuration-guide>` the Azure OpenAI key, being a credential that expires, should have an analogous renewal reminder. Currently only `SONIOX_API_KEY_EXPIRES_AT` is wired (`src/config/expiry.ts` → `warnAboutExpiry()` called from `src/main.ts`). The configuration guide documents the variable as "not yet read by code"; this issue tracks closing that gap. Suggested approach: generalize `evaluateExpiry()` / `warnAboutExpiry()` to take a `{ envName, isoDate, renewUrl }` triple and call it once per tracked credential.

- **Live end-to-end run with a real Soniox API key + microphone** (severity: blocker for release, not for review) — AC-5, AC-6, AC-9, AC-11 from `docs/design/refined-request-soniox-mic-transcriber.md` require a real Soniox session, real audio, and macOS mic permission. All static-code preconditions (units A–E, plus turn detection, plus refinement, plus four-tier env chain) are in place; only the live verification is missing.

- **Optional shell test wrappers under `test_scripts/`** (severity: minor; AC-14) — `test_scripts/test-help.sh`, `test_scripts/test-version.sh`, `test_scripts/test-missing-key.sh`. The existing `test_scripts/` folder contains TypeScript sanity scripts (`sanity-config.ts`, `sanity-mic.ts`, `sanity-renderer.ts`) but the AC-14 shell wrappers are not yet authored. Each should invoke the built binary, capture stdout/stderr/exit code, and assert.

- **Renderer `dispose()` write-after-end risk** (severity: minor) — `StdoutRenderer.dispose()` writes `\x1b[2K\r` to `process.stdout` even after the orchestrator's teardown has decided to exit. In overwrite mode this is intentional (shell-prompt hygiene) and safe because `process.stdout` is a synchronous TTY write. Documented here so a future change to a non-TTY-aware write path doesn't accidentally write after `process.exit`.

## Completed Items

- **Plan-004 documentation backfill** (resolved 2026-05-16). All five docs synced with the current code state:
  - `docs/design/project-functions.md` extended with FR-12..FR-17 and NFR-8..NFR-10.
  - `docs/design/project-design.md` extended with §12 (turn detection), §13 (LLM refinement), §14 (configuration & env-var chain), §15 (decisions log for plans 002/003/004). Existing §12 ("Open Items Carried Forward") renumbered to §16.
  - `docs/design/configuration-guide.md` created from scratch (covers every flag, every env var, the four-tier chain, expiry tracking, storage recommendations, validation rules summary).
  - `README.md` rewritten from a 5-line placeholder into a real user-facing reference.

- **Plan-003 documentation gaps** (resolved 2026-05-16) — `docs/design/plan-003-llm-refinement.md` was in place but the project-design / project-functions docs hadn't picked up §13 / FR-13 / FR-14 / NFR-10. Closed by the plan-004 docs backfill above.

- **Plan-002 documentation gaps** (resolved 2026-05-16) — `docs/design/plan-002-turn-detection.md` was in place but the project-design / project-functions docs hadn't picked up §12 / FR-12. Closed by the plan-004 docs backfill above.

- **README placeholder** (resolved 2026-05-16) — the prior 5-line placeholder is replaced by a full reference covering prerequisites, install, configuration, usage examples, common errors, and links to the design docs.

- **Configuration guide was missing entirely** (resolved 2026-05-16) — created `docs/design/configuration-guide.md` per the CLAUDE.md `<configuration-guide>` rule.

- **Phase 7 review fix — TDZ on `mic` inside `shutdown` closure** (resolved 2026-05-16, see `docs/reference/code-review-phase-7.md`). `src/main.ts` declared `let mic: MicSource | undefined` AFTER the `shutdown` closure that referenced it. If `transcriber.onError` had fired during the (deferred) shutdown microtask before the original declaration site executed, accessing `mic` would have thrown `ReferenceError`. Moved the declaration above the closure and removed the duplicate at the original site.

## Phase 6 Unit Status

- **Unit D (Stdout renderer)** — implemented 2026-05-15, extended 2026-05-16 with `turnBoundary()` (plan-002) and `refined()` (plan-003). `src/render/renderer.ts` now contains a full `StdoutRenderer` covering the three output modes (`overwrite`, `append`, `final-only`), the TTY auto-downgrade (`overwrite` → `append` when `isTTY === false`, applied even when the user explicitly chose `overwrite`), shrinking-partial padding via `prevLen`, embedded `\n`/`\r` sanitisation in overwrite mode, empty-text no-op, and an idempotent `dispose()` that terminates any in-progress overwrite line and emits `\x1b[2K\r` only on a real TTY. `turnBoundary()` writes a single `\n` in all three modes. `refined()` defensively commits any in-progress overwrite-mode partial with `\n` before writing `text + "\n\n"`. Constructor accepts an `out?: NodeJS.WritableStream` injection point for tests. `pnpm typecheck` passes.
- **Unit B (Mic source — macOS SoxMicSource)** — implemented 2026-05-15, refactored 2026-05-16 (plan-004) to accept `sampleRate` from config. `src/mic/soxMicSource.ts` spawns `sox` with `[-q, -d, -t, raw, -r, <sampleRate>, -c, 1, -b, 16, -e, signed-integer, -L, -]`. Constructor takes optional `{ verbose?: boolean; sampleRate?: number }`. The orchestrator passes the resolved `config.sampleRate` from Unit A. All other Phase 6 behaviour (ENOENT → `MicNotAvailableError`, coreaudio/permission classification, idempotent `stop()`, etc.) unchanged.
- **Unit C (Soniox client wrapper — `src/soniox/client.ts`)** — implemented 2026-05-16, refactored 2026-05-16 (plan-004) to take `TranscriberOptions { apiKey, model, endpoint, languages, sampleRate, enableEndpointDetection, verbose }`. `SonioxNodeClient` is constructed with `realtime.ws_base_url: endpoint` so the user-configurable endpoint flows through to the SDK. `language_hints` is the resolved array as-is, EXCEPT when `languages === ["auto"]` in which case the session config substitutes `enable_language_identification: true` instead. `sample_rate` is taken from `opts.sampleRate`. `pnpm typecheck` passes.
- **Unit E (Orchestrator — `src/main.ts`)** — implemented 2026-05-16, extended through plans 002/003/004. `main(argv): Promise<number>` resolves config, calls `warnAboutExpiry(config.apiKeyExpiresAt, config.verbose)` for operational expiry tracking, builds the `StdoutRenderer`, constructs the LLM refiner via `createRefiner(config.llm)` (which throws `LLMConfigurationError` if Azure env vars are missing and refine is on), wraps the renderer in `GuardPhraseTurnDetector` with the refiner, constructs `SonioxTranscriber` with the full new options shape, and wires everything as before. SIGINT/SIGTERM teardown chain unchanged (mic.stop → transcriber.stop → renderer.dispose); the `GuardPhraseTurnDetector.dispose()` delegates to both the refiner (which aborts in-flight LLM requests) and the inner renderer.
- **Unit A (Config & CLI)** — extended 2026-05-16 (plan-004). `src/config.ts` now resolves through `loadEnvChain({ toolName: "mic-tool" })` (in `src/config/envChain.ts`), giving every flag a four-tier fallback. New typed-coercion helpers live in `src/config/parsers.ts`. Expiry warning helper lives in `src/config/expiry.ts`. New CLI flags: `--api-key-expires-at`, `--model`, `--endpoint`, `--sample-rate`, `--no-endpoint-detection`, `--guard-phrase`, `--refine`/`--no-refine`, `--llm-provider`, `--llm-model`. `--language` is now variadic (CLI) AND CSV (env). `ResolvedConfig.language: string` became `ResolvedConfig.languages: string[]`; new fields `model`, `endpoint`, `sampleRate`, `enableEndpointDetection`, `apiKeyExpiresAt?`, `guardPhrase`, `llm: LLMConfig`. `pnpm typecheck` passes.

## Dependency vetting log

All entries follow the format: `<package>@<version pinned> — vetted YYYY-MM-DD — notes`. Vetting consisted of `npm view <pkg> dist-tags` to identify the latest stable major and `pnpm audit --audit-level=high` against a trial install to confirm no HIGH-or-above advisories.

### Runtime dependencies

- `@soniox/node@^2.0.3` — vetted 2026-05-15 — latest stable per `dist-tags.latest`; zero declared transitive deps per investigation; `pnpm audit` clean.
- `commander@^14.0.3` — vetted 2026-05-15 — latest stable per `dist-tags.latest` (v15 is `next`/pre-release only); zero declared transitive deps; `pnpm audit` clean.

### Dev dependencies

- `typescript@^6.0.3` — vetted 2026-05-15 — latest stable per `dist-tags.latest` (published 2026-04-16); `pnpm audit` clean. Required `compilerOptions.types: ["node"]` in `tsconfig.json` because TS 6 no longer auto-includes installed `@types/*` packages.
- `tsx@^4.22.0` — vetted 2026-05-15 — latest stable per `dist-tags.latest`; per CLAUDE.md "fast-moving package" rule we pulled the latest stable major; `pnpm audit` clean (esbuild transitive at 0.28.0, no advisories at HIGH+).
- `@types/node@^20.19.0` — vetted 2026-05-15 — intentionally pinned to the `20.x` line to match `package.json` `engines.node: ">=20.12"`. Newer majors (25.x) exist on npm but typing Node 25 APIs against a Node 20 minimum would risk false-positive compile passes for APIs unavailable at runtime. `pnpm audit` clean.
- `vitest@^4.1.6` — vetted 2026-05-15 — latest stable per `dist-tags.latest`; per CLAUDE.md "fast-moving package" rule we pulled the latest stable major; `pnpm audit` clean (no HIGH+ advisories on the v4 line or its `vite`/`esbuild` transitives).

### Audit result

`pnpm audit --audit-level=high` reports **0 vulnerabilities** for the resolved dependency tree as of 2026-05-15.
