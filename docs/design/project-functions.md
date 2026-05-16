# mic-tool — Functional Requirements

This document captures the functional and non-functional requirements for the `mic-tool` CLI (Soniox microphone live-transcription).
Source: `docs/design/refined-request-soniox-mic-transcriber.md` (refined spec).

## Functional Requirements

### FR-1 — Mic capture
The tool MUST capture live audio from the macOS default microphone input device when started.

### FR-2 — Audio format
The tool MUST deliver audio to Soniox as `pcm_s16le` (16-bit signed PCM, little-endian), 16 kHz, mono — matching `audio_format: "pcm_s16le"`, `sample_rate: 16000`, `num_channels: 1` in the Soniox real-time session config. Confirmed against the `@soniox/node` v2 SDK and the Soniox WebSocket API reference.

### FR-3 — Streaming upload
The tool MUST open a Soniox real-time STT session (`@soniox/node` SDK), send the API key inside the initial JSON config frame (handled by the SDK), stream audio chunks continuously as binary WebSocket frames, and consume transcription `result` events as they arrive.

### FR-4 — Stdout rendering
The tool MUST render incoming transcription text to `stdout` in near real time. The CLI MUST expose `--output-mode {overwrite,append,final-only}` with `overwrite` as the default.

- `overwrite` (default): partial/interim tokens overwrite the current line via `\r`; on `endpoint` (utterance boundary), the committed line is flushed with `\n`.
- `append`: every emitted token is appended on a new line (pipe-friendly).
- `final-only`: only finalized tokens are rendered, one utterance per line; partials are suppressed.

The special marker tokens `<end>` (endpoint boundary) and `<fin>` (manual-finalization boundary) MUST be filtered out of displayed text in all modes.

**FR-4.1 — Pipe safety (auto-downgrade)**: When `process.stdout.isTTY === false` (i.e. stdout is piped or redirected), the renderer MUST silently downgrade `overwrite` to `append`. This applies even when the user explicitly specifies `--output-mode overwrite`. Rationale: `\r` artifacts in a file are never desirable. In verbose mode the downgrade MUST be logged once to stderr.

### FR-5 — API key from config
The tool MUST resolve the Soniox API key from one of the following sources, in this precedence order (highest first):

1. `--api-key <value>` CLI flag.
2. Local `.env` file in the working directory (variable `SONIOX_API_KEY`), loaded via Node-native `process.loadEnvFile()`.
3. Shell environment variable `SONIOX_API_KEY`.

If no key is found through any of these sources, the tool MUST raise a named `MissingConfigurationError` and exit with a non-zero code. No fallback, default, or placeholder key is permitted.

### FR-6 — Help and version
The tool MUST support `--help` (usage block with every flag and at least one usage example) and `--version` (semver from `package.json`). Both exit with code `0`.

### FR-7 — Graceful shutdown
On `SIGINT` (Ctrl+C) or `SIGTERM`, the tool MUST: (1) stop microphone capture (`sox` child), (2) call `session.finalize()` to commit pending partials, (3) call `session.finish()` to send the end-of-stream frame and drain finals, (4) close the WebSocket, (5) flush any remaining finals to `stdout`, (6) exit with code `0`. The shutdown sequence MUST be bounded by a 1.5 s timeout falling back to `session.close()` to prevent deadlocks.

### FR-8 — Language flag
The tool MUST accept an optional `--language <code>` flag (default `en`) forwarded to the Soniox session configuration as `language_hints: [code]`. The value `auto` MUST be accepted and translated into `enable_language_identification: true` with no `language_hints` (per `@soniox/node` v2).

### FR-9 — Verbosity
The tool MUST accept `--verbose` / `-v` to emit diagnostic logs (connection lifecycle, audio frame counts, `total_audio_proc_ms` counters, errors) to `stderr`. `stdout` MUST contain only transcript text regardless of verbosity. SoX's stderr output MUST be suppressed unless `--verbose` is enabled.

### FR-10 — Idle/silence handling
The tool MUST keep the Soniox session alive during silence. Because the SDK auto-sends keepalive frames only while `pause()`d, and v1 does not pause, this is satisfied by the continuous audio stream from `sox` (audio frames serve as implicit keepalives; server's 20-second hard timeout is never reached during active capture).

### FR-11 — Stable exit codes
The tool MUST exit with a deterministic, documented exit code reflecting the failure class:

| Code | Constant                    | Meaning                                                                  |
|-----:|-----------------------------|--------------------------------------------------------------------------|
| 0    | `SUCCESS`                   | Clean exit (SIGINT or end of stream).                                    |
| 1    | `UNKNOWN`                   | Any non-typed exception.                                                 |
| 2    | `MISSING_CONFIG`            | `MissingConfigurationError` (no API key, invalid `--language`, etc.).    |
| 3    | `MIC_UNAVAILABLE_OR_DENIED` | sox not installed, mic permission denied, or unsupported platform.       |
| 4    | `SONIOX_AUTH`               | Soniox rejected the API key (`AuthError`).                               |
| 5    | `SONIOX_NETWORK`            | Soniox unreachable, pre-connect or mid-stream drop.                      |
| 6    | `SONIOX_PROTOCOL`           | Soniox returned a protocol-level error (bad request, quota, etc.).       |

The exit-code map is the authoritative contract for shell scripts and CI consumers.

## Non-Functional Requirements

### NFR-1 — Language and runtime
TypeScript (strict mode), targeting Node.js LTS >= 20.12 (required for `process.loadEnvFile`).

### NFR-2 — End-to-end latency
First finalized transcript line SHOULD appear on `stdout` within 1.5 s of phrase end on a healthy network. CLI overhead MUST stay under 200 ms beyond the Soniox round-trip.

### NFR-3 — Resource footprint
Steady-state memory < 150 MB; CPU < 25% of one Apple Silicon core during continuous transcription.

### NFR-4 — Dependency hygiene
All runtime dependencies vetted per the project's dependency-vetting policy. `pnpm audit` MUST report zero HIGH-or-above advisories before merge. Vetting decisions recorded in `Issues - Pending Items.md`.

### NFR-5 — No hidden defaults
Configuration that lacks a value MUST raise a typed error. Documented defaults (`--language en`, `--output-mode overwrite`) are explicit and live in the CLI definition, not in fallback substitution logic.

### NFR-6 — Cross-platform-friendliness (advisory)
Mic-capture is isolated behind a `MicSource` interface so future Linux/Windows backends (e.g. `arecord`, `ffmpeg -f dshow`) plug in without touching the Soniox pipeline. Non-macOS implementations ship as `NotImplementedError` stubs in v1.

### NFR-7 — Documentation
A user-facing `README.md` MUST document: installation, prerequisites (`brew install sox`, macOS mic permission, Node version, Soniox account), every CLI flag, all configuration sources with precedence, troubleshooting per error class.

---

## Functional Requirements added since v0.1.0

The following FRs cover plans 002 (turn detection), 003 (LLM refinement), and 004 (full env-var fallbacks + key-expiry tracking).

### FR-12 — Guard-phrase turn detection
The tool MUST detect a configurable *guard phrase* in the recent finalized transcript and treat its appearance as a *turn boundary*. On detection the renderer MUST emit a single blank line on stdout. Matching MUST be insensitive to case, accents (NFD-decomposed combining marks stripped), and surrounding punctuation. The guard phrase MUST match whether it appears inside a single final OR across consecutive recent finals (rolling buffer, capped at 2000 characters). Default phrase: `τέλος εντολής`. Configurable via `--guard-phrase` / `MIC_TOOL_GUARD_PHRASE`. The phrase remains visible in the line that triggered the boundary — it is NOT stripped from the rendered transcript.

### FR-13 — LLM refinement of each closed turn
When LLM refinement is enabled, the tool MUST, after each turn boundary, capture the turn's verbatim text (with the guard phrase removed for the LLM input only), send it asynchronously to the configured LLM, and on success render the refined text on its own line followed by an additional blank line. Refinement is non-blocking: subsequent transcription continues immediately. If the LLM call fails (auth, network, timeout, server, malformed response), the failure MUST be logged under `--verbose` and skipped — the verbatim transcript above the blank line is the user's fallback. If the renderer has been disposed before the refinement resolves, the result MUST be dropped silently.

### FR-14 — LLM provider abstraction
The tool MUST support the eight standard LLM provider names mandated by the project's tool conventions: `azure-openai`, `openai`, `anthropic`, `google`, `azure-ai-inference`, `ollama`, `litellm`, `openai-compat`. In v1, only `azure-openai` is fully implemented. The other seven MUST be accepted by configuration validation but MUST throw `LLMConfigurationError` at refiner construction with a message naming the env vars to set when the provider lands. Provider selection is via `--llm-provider` / `MIC_TOOL_LLM_PROVIDER` (default: `azure-openai`); model/deployment selection is via `--llm-model` / `MIC_TOOL_LLM_MODEL` (default: `gpt-5.4`). Refinement is toggled by `--refine` / `--no-refine` / `MIC_TOOL_REFINE` (default: on).

### FR-15 — Four-tier env-var resolution chain
Every CLI flag MUST have a documented env-var alias. The resolver MUST consult sources in this priority order (highest first):

1. CLI flag value.
2. `<cwd>/.env` (project-local).
3. `~/.tool-agents/mic-tool/.env` (per-user; folder mode `0700`, file mode `0600`).
4. Shell environment (`process.env`).

The resolver MUST NOT mutate `process.env`. Whitespace-only values from any tier MUST be treated as missing. Malformed `.env` files MUST raise `InvalidConfigurationError` rather than be silently ignored.

### FR-16 — Configurable Soniox session parameters
The tool MUST expose configuration for every non-secret Soniox session parameter that affects transcription behaviour:

| Aspect                  | CLI flag                  | Env var                              | Default                                                |
|-------------------------|---------------------------|--------------------------------------|--------------------------------------------------------|
| Real-time model         | `--model`                 | `MIC_TOOL_MODEL`                     | `stt-rt-v4`                                            |
| WebSocket endpoint      | `--endpoint`              | `MIC_TOOL_ENDPOINT`                  | `wss://stt-rt.soniox.com/transcribe-websocket`         |
| Language hints (repeat) | `--language` (variadic)   | `MIC_TOOL_LANGUAGES` (CSV)           | `el,en`                                                |
| PCM sample rate         | `--sample-rate`           | `MIC_TOOL_SAMPLE_RATE`               | `16000`                                                |
| Endpoint detection      | `--no-endpoint-detection` | `MIC_TOOL_ENABLE_ENDPOINT_DETECTION` | `true`                                                 |

`--language auto` MUST translate to `enable_language_identification: true` with no `language_hints`, and MUST NOT be combinable with other codes. The sample rate fed to `sox` and to the Soniox session MUST be the same value.

### FR-17 — API-key expiry tracking
The tool MUST accept an optional ISO date (`YYYY-MM-DD`) via `--api-key-expires-at` / `SONIOX_API_KEY_EXPIRES_AT` that records the renewal deadline of the Soniox key. At startup the tool MUST evaluate the date:

- If the date is in the past → emit a single stderr line `[mic-tool] WARNING: SONIOX_API_KEY expired N days ago (YYYY-MM-DD). Renew at https://console.soniox.com.`
- Else if the date is within 14 days of today → emit `[mic-tool] WARNING: SONIOX_API_KEY expires in N days (YYYY-MM-DD). Plan a renewal.`
- Else only emit a status line when `--verbose` is set.

Expiry is operational; the tool MUST NOT refuse to run because of it. The user owns renewal.

## Non-Functional Requirements added since v0.1.0

### NFR-8 — No fallback for missing required config (restated for LLM)
When `--refine` is enabled and the resolved provider is `azure-openai`, the resolver MUST throw `LLMConfigurationError` (exit 2) if any of `AZURE_OPENAI_API_KEY` / `AZURE_OPENAI_ENDPOINT` are missing across all four tiers. The error message MUST enumerate the missing variables AND list the four tiers in priority order so the user knows where to set them.

### NFR-9 — Typed env-value parsing
A single helper module (`src/config/parsers.ts`) MUST provide strict typed coercion for every non-string env value: boolean (`true|false|yes|no|on|off|1|0`, case-insensitive), positive integer with optional `[min, max]` range, ISO calendar date round-tripped through `Date.UTC`, and `wss://` / `ws://` URL validation. Parse failures MUST throw `InvalidConfigurationError` naming BOTH the CLI flag AND the env var so the user can fix whichever they set.

### NFR-10 — LLM refinement is fail-open
LLM refinement failures during runtime (auth, network, timeout, server, shape) MUST NOT cause `main()` to exit with a non-zero code. They are logged under `--verbose` (tagged `llm-auth` / `llm-network` / `llm-timeout` / `llm-server` / `llm-shape`) and otherwise silently swallowed. Only startup-time `LLMConfigurationError` (NFR-8) is fatal.
