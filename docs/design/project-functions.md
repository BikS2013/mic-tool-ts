# mic-tool-ts — Functional Requirements

This document captures the functional and non-functional requirements for the `mic-tool-ts` CLI (microphone live-transcription through Soniox or ElevenLabs).
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
- `append`: every non-duplicate emitted token is appended on a new line (pipe-friendly).
- `final-only`: only finalized tokens are rendered, one utterance per line; partials are suppressed.

The special marker tokens `<end>` (endpoint boundary) and `<fin>` (manual-finalization boundary) MUST be filtered out of displayed text in all modes.

The renderer MUST suppress identical consecutive partial snapshots before writing to stdout. Realtime STT providers can repeat the same interim hypothesis several times before committing it; those repeated snapshots must not appear as duplicate transcript lines or duplicated copied terminal text.

In TTY `overwrite` mode, the renderer MUST handle partials that exceed the terminal column width and wrap across multiple physical rows. Before painting the next partial or final snapshot, it MUST clear every physical row occupied by the previous overwrite snapshot and return the cursor to the first row of that region. Single-line overwrite behaviour remains `\r` plus padding; non-TTY output MUST NOT receive ANSI cursor movement.

The Soniox adapter MUST also guard against repeated finalized prefixes inside result frames. If a result repeats the current finalized prefix and adds or changes only the non-final suffix, the adapter MUST replace or overlap-merge the committed prefix rather than append it again.

**FR-4.1 — Pipe safety (auto-downgrade)**: When `process.stdout.isTTY === false` (i.e. stdout is piped or redirected), the renderer MUST silently downgrade `overwrite` to `append`. This applies even when the user explicitly specifies `--output-mode overwrite`. Rationale: `\r` artifacts in a file are never desirable. In verbose mode the downgrade MUST be logged once to stderr.

### FR-5 — API key from config
The tool MUST resolve the Soniox API key from one of the following sources, in this precedence order (highest first):

1. `--api-key <value>` CLI flag.
2. Local `.env` file in the working directory (variable `SONIOX_API_KEY`).
3. Per-user secret store `~/.tool-agents/mic-tool-ts/.env`.
4. Shell environment variable `SONIOX_API_KEY`.

If no key is found through any of these sources, the tool MUST raise a named `MissingConfigurationError` and exit with a non-zero code. No fallback, default, or placeholder key is permitted.

### FR-6 — Help and version
The tool MUST support `--help` (usage block with every flag and at least one usage example) and `--version` (semver from `package.json`). Both exit with code `0`.

### FR-7 — Graceful shutdown
On `SIGINT` (Ctrl+C) or `SIGTERM`, the tool MUST: (1) stop microphone capture (`sox` child), (2) call `session.finalize()` to commit pending partials, (3) call `session.finish()` to send the end-of-stream frame and drain finals, (4) close the WebSocket, (5) flush any remaining finals to `stdout`, (6) exit with code `0`. The shutdown sequence MUST be bounded by a 1.5 s timeout falling back to `session.close()` to prevent deadlocks.

### FR-8 — Language flag
The tool MUST accept repeatable `--language <code>` flags (default `el,en`) forwarded to the Soniox session configuration as `language_hints`. The value `auto` MUST be accepted and translated into `enable_language_identification: true` with no `language_hints` (per `@soniox/node` v2), and `auto` MUST NOT be combined with other language hints.

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
TypeScript (strict mode), targeting Node.js LTS >= 20.12.

### NFR-2 — End-to-end latency
First finalized transcript line SHOULD appear on `stdout` within 1.5 s of phrase end on a healthy network. CLI overhead MUST stay under 200 ms beyond the Soniox round-trip.

### NFR-3 — Resource footprint
Steady-state memory < 150 MB; CPU < 25% of one Apple Silicon core during continuous transcription.

### NFR-4 — Dependency hygiene
All runtime dependencies vetted per the project's dependency-vetting policy. `pnpm audit` MUST report zero HIGH-or-above advisories before merge. Vetting decisions recorded in `Issues - Pending Items.md`.

### NFR-5 — No hidden defaults
Configuration that lacks a required value MUST raise a typed error. Documented defaults (`--language el,en`, `--output-mode overwrite`, and other optional parameters listed in the configuration guide) are explicit constants in `src/config.ts`, not ad hoc fallback substitutions.

### NFR-6 — Cross-platform-friendliness (advisory)
Mic-capture is isolated behind a `MicSource` interface so future Linux/Windows backends (e.g. `arecord`, `ffmpeg -f dshow`) plug in without touching the Soniox pipeline. Non-macOS implementations ship as `NotImplementedError` stubs in v1.

### NFR-7 — Documentation
A user-facing `README.md` MUST document: installation, prerequisites (`brew install sox`, macOS mic permission, Node version, Soniox account), every CLI flag, all configuration sources with precedence, troubleshooting per error class.

---

## Functional Requirements added since v0.1.0

The following FRs cover plans 002 (turn detection), 003 (LLM refinement), and 004 (full env-var fallbacks + key-expiry tracking).

### FR-12 — Guard-phrase turn detection
The tool MUST detect a configurable *guard phrase* in the recent finalized transcript and treat its appearance as a *turn boundary*. On detection the renderer MUST emit a single blank line on stdout. Matching MUST be insensitive to case, accents (NFD-decomposed combining marks stripped), and surrounding punctuation. The guard phrase MUST match whether it appears inside a single final OR across consecutive recent finals (rolling buffer, capped at 2000 characters). Default phrase: `τέλος εντολής`. Configurable via `--guard-phrase` / `MIC_TOOL_TS_GUARD_PHRASE`. The phrase remains visible in the line that triggered the boundary — it is NOT stripped from the rendered transcript.

### FR-13 — LLM refinement of each closed turn
When LLM refinement is enabled, the tool MUST, after each turn boundary, capture the turn's verbatim text (with the guard phrase removed for the LLM input only), send it asynchronously to the configured LLM, and on success render the refined text on its own line followed by an additional blank line. Refinement is non-blocking: subsequent transcription continues immediately. If the LLM call fails (auth, network, timeout, server, malformed response), the failure MUST be logged under `--verbose` and skipped — the verbatim transcript above the blank line is the user's fallback. If the renderer has been disposed before the refinement resolves, the result MUST be dropped silently.

### FR-14 — LLM provider abstraction
The tool MUST support the eight standard LLM provider names mandated by the project's tool conventions: `azure-openai`, `openai`, `anthropic`, `google`, `azure-ai-inference`, `ollama`, `litellm`, `openai-compat`. In v1, only `azure-openai` is fully implemented. The other seven MUST be accepted by configuration validation but MUST throw `LLMConfigurationError` at refiner construction with a message naming the env vars to set when the provider lands. Provider selection is via `--llm-provider` / `MIC_TOOL_TS_LLM_PROVIDER` (default: `azure-openai`); model/deployment selection is via `--llm-model` / `MIC_TOOL_TS_LLM_MODEL` (default: `gpt-5.4`). Refinement is toggled by `--refine` / `--no-refine` / `MIC_TOOL_TS_REFINE` (default: on).

### FR-15 — Four-tier env-var resolution chain
Every CLI flag MUST have a documented env-var alias. The resolver MUST consult sources in this priority order (highest first):

1. CLI flag value.
2. `<cwd>/.env` (project-local).
3. `~/.tool-agents/mic-tool-ts/.env` (per-user; folder mode `0700`, file mode `0600`).
4. Shell environment (`process.env`).

The resolver MUST NOT mutate `process.env`. Whitespace-only values from any tier MUST be treated as missing. Malformed `.env` files MUST raise `InvalidConfigurationError` rather than be silently ignored.

### FR-16 — Configurable Soniox session parameters
The tool MUST expose configuration for every non-secret Soniox session parameter that affects transcription behaviour:

| Aspect                  | CLI flag                  | Env var                              | Default                                                |
|-------------------------|---------------------------|--------------------------------------|--------------------------------------------------------|
| Real-time model         | `--model`                 | `MIC_TOOL_TS_MODEL`                     | `stt-rt-v4`                                            |
| WebSocket endpoint      | `--endpoint`              | `MIC_TOOL_TS_ENDPOINT`                  | `wss://stt-rt.soniox.com/transcribe-websocket`         |
| Language hints (repeat) | `--language` (variadic)   | `MIC_TOOL_TS_LANGUAGES` (CSV)           | `el,en`                                                |
| PCM sample rate         | `--sample-rate`           | `MIC_TOOL_TS_SAMPLE_RATE`               | `16000`                                                |
| Endpoint detection      | `--no-endpoint-detection` | `MIC_TOOL_TS_ENABLE_ENDPOINT_DETECTION` | `true`                                                 |

`--language auto` MUST translate to `enable_language_identification: true` with no `language_hints`, and MUST NOT be combinable with other codes. The sample rate fed to `sox` and to the Soniox session MUST be the same value.

### FR-17 — API-key expiry tracking
The tool MUST accept an optional ISO date (`YYYY-MM-DD`) via `--api-key-expires-at` / `SONIOX_API_KEY_EXPIRES_AT` that records the renewal deadline of the Soniox key. At startup the tool MUST evaluate the date:

- If the date is in the past → emit a single stderr line `[mic-tool-ts] WARNING: SONIOX_API_KEY expired N days ago (YYYY-MM-DD). Renew at https://console.soniox.com.`
- Else if the date is within 14 days of today → emit `[mic-tool-ts] WARNING: SONIOX_API_KEY expires in N days (YYYY-MM-DD). Plan a renewal.`
- Else only emit a status line when `--verbose` is set.

Expiry is operational; the tool MUST NOT refuse to run because of it. The user owns renewal.

### FR-18 — Renamed command and config namespace
The project package and user-facing OS command MUST be named `mic-tool-ts`. The supported end-user invocation is the direct OS command `mic-tool-ts` on the user's `PATH`, not a `node`, `tsx`, `pnpm`, or npm-script wrapper. The per-user configuration folder MUST be `~/.tool-agents/mic-tool-ts/`, and project-specific environment variables MUST use the `MIC_TOOL_TS_*` prefix.

### FR-19 — Startup readiness message
After the selected STT provider has connected, the microphone source has started, and signal handlers are installed, the tool MUST write a startup readiness line to stderr: `[mic-tool-ts] Ready to listen. Press Control-C to stop the listening tool.` This message is unconditional, because it is operational guidance, but it MUST NOT be written to stdout so transcript output remains pipe-safe.

### FR-20 — Alternative ElevenLabs transcription provider
The tool MUST support `--stt-provider soniox|elevenlabs` / `MIC_TOOL_TS_STT_PROVIDER`, with `soniox` as the default. When `elevenlabs` is selected, the resolver MUST require `ELEVENLABS_API_KEY` or `--elevenlabs-api-key` and MUST NOT require `SONIOX_API_KEY`. The ElevenLabs provider MUST stream the existing PCM microphone chunks to the ElevenLabs realtime STT WebSocket endpoint, emit partial transcripts from `partial_transcript`, emit finals from `committed_transcript`, and map provider failures into typed auth/network/protocol errors. ElevenLabs language config MUST accept `auto` or one explicit language code; multiple language hints are rejected for this provider. When endpoint detection is enabled, ElevenLabs MUST use VAD commit strategy.

## Non-Functional Requirements added since v0.1.0

### NFR-8 — No fallback for missing required config (restated for LLM)
When `--refine` is enabled and the resolved provider is `azure-openai`, the resolver MUST throw `LLMConfigurationError` (exit 2) if any of `AZURE_OPENAI_API_KEY` / `AZURE_OPENAI_ENDPOINT` are missing across all four tiers. The error message MUST enumerate the missing variables AND list the four tiers in priority order so the user knows where to set them.

### NFR-9 — Typed env-value parsing
A single helper module (`src/config/parsers.ts`) MUST provide strict typed coercion for every non-string env value: boolean (`true|false|yes|no|on|off|1|0`, case-insensitive), positive integer with optional `[min, max]` range, ISO calendar date round-tripped through `Date.UTC`, and `wss://` / `ws://` URL validation. Parse failures MUST throw `InvalidConfigurationError` naming BOTH the CLI flag AND the env var so the user can fix whichever they set.

### NFR-10 — LLM refinement is fail-open
LLM refinement failures during runtime (auth, network, timeout, server, shape) MUST NOT cause `main()` to exit with a non-zero code. They are logged under `--verbose` (tagged `llm-auth` / `llm-network` / `llm-timeout` / `llm-server` / `llm-shape`) and otherwise silently swallowed. Only startup-time `LLMConfigurationError` (NFR-8) is fatal.

---

## Functional Requirements — Voice Agent Command Protocol

Source: `docs/design/request-008-voice-agent-command-protocol.md`, `docs/design/plan-007-voice-agent-command-protocol.md`, and `docs/design/request-010-command-status.md`.
Status: implemented 2026-05-16.

### FR-21 — Interaction modes
The tool MUST support `--interaction-mode dictation|agent-protocol|hybrid` / `MIC_TOOL_TS_INTERACTION_MODE`. `dictation` preserves human-facing transcript and processed-section output. `agent-protocol` emits machine-readable JSONL protocol events for downstream agents. `hybrid` requires `--protocol-output` / `MIC_TOOL_TS_PROTOCOL_OUTPUT` and MUST NOT silently mix human transcript text and protocol events in the same stream.

### FR-22 — Spoken control markers
The protocol MUST recognize configurable spoken markers for state commands, section submission, section cancellation, and literal-marker escape, with defaults `command`, `command send`, `command cancel`, and `literal phrase`. Marker matching MUST run on finalized STT text only. Slash-marker intent MUST be preserved for explicitly configured slash markers so they do not degrade to bare-word matches after punctuation normalization.

### FR-23 — Operator state and section processing
The protocol MUST maintain persistent operator state for `refine`, `translate`, `clipboard`, and `input`. `command <operator>` enables the operator, and `command <operator> off` disables it. `command status` reports the current operator state, translation policy, and whether an unsent section is pending without changing operator state. `command send` submits the current paragraph or text section for processing by the active operators. `command cancel` drops the current section without processing. Marker phrases and state commands MUST be removed from section payloads.

### FR-24 — JSONL agent events
Agent protocol mode MUST emit one UTF-8 JSON object per line with monotonically increasing `seq` values. Downstream agents can act on `session.started`, `state.changed`, `status.reported`, `section.submitted`, `section.processed`, `section.cancelled`, `clipboard.copied`, `input.sent`, `protocol.warning`, and `session.ended` events without parsing free-form transcript text.

### FR-25 — Complete-section operator pipeline
Operators MUST run only on complete submitted sections, never partial words. The active pipeline at `command send` is raw section → refine if enabled → translate if enabled → render or emit final output → copy to clipboard if enabled → send to focused input if enabled. The default translation policy translates Greek source text to English and English source text to Greek, with language detection based on the complete submitted section.

### FR-26 — Remembered protocol settings
The tool MUST remember non-secret voice-agent protocol settings across graceful restarts. On shutdown it MUST persist the current `refine`, `translate`, `clipboard`, `input`, and `translation_policy` values to `~/.tool-agents/mic-tool-ts/state.json` using file mode `0600` in a `0700` per-user tool folder. On startup it MUST restore those values when the corresponding CLI/env default was not explicitly configured. Explicit `--refine-default`, `--translate-default`, `--clipboard-default`, `--input-default`, and `--translation-policy` values MUST override saved state. The persisted file MUST NOT contain API keys, provider endpoints, prompts, transcript text, or processed section content. Invalid persisted state at startup MUST raise a typed configuration error.

### FR-27 — Focused input operator
When the `input` operator is enabled, the tool MUST send the final processed section output to the currently focused macOS input control after the section pipeline completes. The implementation MUST use a dependency-free macOS path (`pbcopy` plus System Events Command-V) and MUST emit `input.sent` on success in protocol modes. Focused-input failures, including missing Accessibility permission, MUST be fail-open: they emit a non-fatal stderr warning and a `protocol.warning` event in protocol modes, and they MUST NOT cause the process to exit non-zero.

## Non-Functional Requirements — Voice Agent Command Protocol

### NFR-11 — Stream separation
Human transcript text and machine protocol events MUST remain stream-separated by default. If `stdout` is used for JSONL protocol events, human diagnostics and readiness text MUST remain on `stderr`.

### NFR-12 — Protocol robustness
The protocol MUST prefer deterministic command-prefixed markers over inference-based intent detection. False state changes or section processing are more harmful than requiring explicit `command refine`, `command send`, and `command cancel` markers.

---

## Proposed Functional Requirements — Electron UI Command

Source: `docs/design/request-014-electron-ui-command.md`, `docs/design/plan-008-electron-ui-command.md`, `docs/design/request-016-modern-macos-ui-review.md`, `docs/design/plan-009-modern-macos-ui-review.md`, `docs/reference/investigation-008-electron-ui-command.md`, and `docs/reference/investigation-009-modern-macos-ui-review.md`.
Status: proposed, not implemented.

### FR-28 — Electron UI subcommand
The tool SHOULD add `mic-tool-ts ui` as a user-facing subcommand that opens an Electron-based UI while preserving the existing `mic-tool-ts` CLI behavior.

### FR-29 — UI-owned transcript rendering
When UI mode is active, human-facing partial transcripts, final transcripts, refined or translated outputs, readiness messages, warnings, and session status SHOULD render in the UI instead of stdout/stderr. Console output SHOULD be limited to fatal bootstrap or crash diagnostics that cannot be delivered to the UI.

### FR-30 — UI configuration surface
The UI SHOULD expose the existing major configuration categories: STT provider, API-key status and expiry, model, endpoint, language hints, sample rate, endpoint detection, guard phrase, protocol markers, operator defaults, translation policy, LLM refinement settings, and diagnostics. Missing required configuration MUST still raise typed configuration errors; the UI MUST NOT substitute fallback values.

### FR-31 — UI event stream
The UI SHOULD receive typed events for session lifecycle, transcript partials/finals, turn boundaries, refined output, protocol events, warnings, diagnostics, and audio state. The UI MUST NOT parse terminal output to derive its state.

### FR-32 — macOS visual target
The UI SHOULD target the current macOS Tahoe 26 design language with native-feeling traffic lights, a translucent sidebar/control layer, restrained animation, system typography, and high-legibility content surfaces. The implementation SHOULD use Electron's macOS vibrancy/window APIs and local CSS to approximate Liquid Glass while respecting reduced-motion and reduced-transparency accessibility settings. The preferred visual direction is the Plan 009 revision: transcript content remains the primary stable content plane, while glass-like styling is reserved mainly for navigation, toolbars, segmented controls, and capture controls.

## Proposed Non-Functional Requirements — Electron UI Command

### NFR-13 — Electron security boundary
The Electron renderer MUST load only local packaged content, MUST NOT have Node.js integration, MUST use context isolation and sandboxing, and MUST communicate with the main process through a narrow preload bridge that validates payloads.

### NFR-14 — Dependency vetting for Electron
Before adding Electron or any UI build/runtime dependency, the implementation MUST follow the project's dependency-vetting policy, pin a vetted current stable version, run the audit command, and record the decision in `Issues - Pending Items.md`.
