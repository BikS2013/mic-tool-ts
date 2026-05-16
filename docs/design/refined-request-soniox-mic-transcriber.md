# Refined Request: Soniox Microphone Live Transcription CLI

## Category
Development

## Objective
Build a TypeScript command-line tool that captures audio from the user's microphone on macOS, streams it in real time to the Soniox speech-recognition service, and renders the returned transcription text to the console as it is produced. The tool must be self-contained, runnable from the terminal, and must obtain its Soniox API key from the user via standard configuration channels (env var, local `.env`, or CLI flag) — never from a hardcoded fallback.

## Scope

### In scope
- A single TypeScript CLI binary (executable via `node`, `tsx`, or a published `bin` entry).
- Microphone capture from the macOS default input device (PCM audio at a sample rate/channel layout compatible with the Soniox real-time API).
- Real-time, bidirectional integration with the Soniox streaming WebSocket API.
- Streaming the transcribed text to `stdout` with a readable rendering of both partial (interim) and final transcript segments.
- Standard CLI ergonomics: `--help`, `--version`, exit codes, graceful `SIGINT`/`SIGTERM` shutdown that closes the mic stream and the Soniox session cleanly.
- API key resolution from (in order of precedence) CLI flag > local `.env` file > shell environment variable; with a clear error if none is supplied.
- Structured error handling for the failure modes enumerated below.
- Basic logging to `stderr` (so that `stdout` remains a clean transcript stream that can be piped).

### Out of scope (v1)
- Non-macOS platforms (Linux/Windows). The design should not preclude them, but they are not validated in v1.
- Audio file (batch) transcription — only live microphone capture is supported.
- Multi-microphone enumeration / device selection (assume OS default input device).
- Speaker diarization, custom vocabulary, language hints beyond a single configurable language code.
- Persisting transcripts to disk (users can redirect `stdout` with shell `>` if they need a file).
- A GUI, TUI dashboard, or any web component.
- Authentication mechanisms other than the Soniox API key (no OAuth, no proxying).

## Requirements

### Functional
1. **FR-1 Mic capture**: The tool MUST capture live audio from the macOS default microphone input device when started.
2. **FR-2 Audio format**: The tool MUST deliver audio to Soniox in the format required by the Soniox real-time WebSocket API (typically 16-bit signed PCM, 16 kHz, mono, little-endian — exact parameters to be confirmed against Soniox's current docs during the investigation phase).
3. **FR-3 Streaming upload**: The tool MUST open a WebSocket session to Soniox, send the API key as the service requires (typically in the first JSON config frame), stream audio chunks continuously, and consume transcription events as they arrive.
4. **FR-4 Stdout rendering**: The tool MUST render incoming transcription text to `stdout` in near real time. Default rendering: partial/interim text is shown on the current line (using `\r` carriage-return overwrite), and each final segment is committed to a new line. The implementation MAY expose this as `--output-mode {overwrite,append,final-only}` with `overwrite` as the default.
5. **FR-5 API key from config**: The tool MUST read the Soniox API key from one of the following sources, in this precedence order (highest first):
   1. `--api-key <value>` CLI flag.
   2. Local `.env` file in the working directory (variable `SONIOX_API_KEY`).
   3. Shell environment variable `SONIOX_API_KEY`.
   If no key is found through any of these sources, the tool MUST raise a clear, named error and exit with a non-zero code. No fallback or placeholder key is permitted.
6. **FR-6 Help and version**: The tool MUST support `--help` (usage, flags, examples) and `--version` (semver from `package.json`).
7. **FR-7 Graceful shutdown**: On `SIGINT` (Ctrl+C) or `SIGTERM`, the tool MUST stop microphone capture, send any required end-of-stream signal to Soniox, drain remaining final transcripts to `stdout`, close the WebSocket, and exit with code `0`.
8. **FR-8 Language flag**: The tool MUST accept an optional `--language <code>` flag (default `en`) that is forwarded to the Soniox session configuration. If Soniox supports auto-detect, `auto` MUST be accepted as a valid value.
9. **FR-9 Verbosity**: The tool MUST accept `--verbose` / `-v` to emit diagnostic logs (connection lifecycle, audio frame counts, errors) to `stderr`. `stdout` MUST contain only transcript text regardless of verbosity.
10. **FR-10 Idle/silence handling**: The tool MUST keep the Soniox session alive during silence (per Soniox keep-alive protocol) and continue rendering finals when speech resumes, without the user needing to restart the process.

### Non-functional
11. **NFR-1 Language & runtime**: TypeScript, targeting Node.js LTS (>= 20). Compiled or executed via `tsx` for local runs.
12. **NFR-2 End-to-end latency**: From the moment the user finishes speaking a phrase, the first finalized transcript line SHOULD appear on `stdout` within 1.5 seconds on a healthy network (this is bounded by Soniox's own latency; the tool itself must add < 200 ms of overhead beyond the network/service round-trip).
13. **NFR-3 Resource footprint**: Steady-state memory usage SHOULD remain under 150 MB; CPU usage SHOULD remain under 25% of one core on a 2020+ Apple Silicon Mac during continuous transcription.
14. **NFR-4 Dependency hygiene**: All runtime dependencies MUST be vetted per the project's dependency-vetting policy in `CLAUDE.md` (latest non-vulnerable major, audit clean before merge).
15. **NFR-5 No hidden defaults**: Configuration that lacks a value MUST raise a typed error — never silently substitute a default beyond the documented ones (language `en`, output-mode `overwrite`, Node-version requirement).
16. **NFR-6 Cross-platform-friendliness (advisory)**: The mic-capture and audio-encoding layer SHOULD be isolated behind an interface so a future Linux/Windows backend can be plugged in without rewriting the Soniox pipeline. Not required to ship in v1.
17. **NFR-7 Documentation**: A `README.md` (or equivalent under `docs/`) MUST document installation, prerequisites (macOS mic permission grant, Node version, Soniox account), all CLI flags, all configuration sources with precedence, and the troubleshooting steps for each error class.

## Constraints

### Technical
- **Language**: TypeScript only (project convention).
- **Node**: Node.js LTS (20.x or 22.x).
- **OS target (v1)**: macOS (Darwin) — confirmed via project env.
- **No SQLAlchemy / no Python**: This is a TypeScript project; the Python-specific conventions in the global instructions do not apply.
- **No hardcoded API keys or fallback config values** (project rule).
- **Dependency vetting**: Before pinning any new runtime dependency (audio capture lib, WebSocket lib, dotenv, CLI framework), follow the procedure in `CLAUDE.md` § dependency-vetting. Especially scrutinize native audio bindings (e.g. `node-record-lpcm16`, `mic`, `naudiodon`, `@discordjs/voice` peers) for maintenance status and CVEs, and prefer the latest non-vulnerable major.
- **Soniox API contract**: Endpoint, auth header/frame format, audio encoding, and event schema MUST be confirmed from current Soniox documentation during the investigation phase — do not assume; the values in FR-2 are starting hypotheses.

### Process
- Plans, design, and functional-spec docs MUST live under `docs/design/` per project conventions.
- Test scripts MUST live under `test_scripts/`.
- Any issues discovered MUST be logged in `Issues - Pending Items.md` at the project root.
- Any new tool created as part of this work (e.g. a reusable mic-capture or websocket-client tool) MUST be scaffolded via `/tool-conventions scaffold` per the global rule — never by hand.

### Resource
- Requires a valid Soniox account and API key for end-to-end testing.
- Requires macOS microphone permission granted to the terminal application (Terminal, iTerm2, VS Code, etc.) running the tool.

## Acceptance Criteria

Each criterion below must be demonstrable on a fresh checkout on a macOS machine with a Soniox API key.

1. **AC-1 Builds clean**: `pnpm install` (or chosen package manager) + `pnpm build` completes with zero errors and zero HIGH-or-above audit advisories.
2. **AC-2 Help works**: Running `mic-tool --help` prints a usage block listing every supported flag (`--api-key`, `--language`, `--output-mode`, `--verbose`, `--help`, `--version`) with one-line descriptions, plus at least one usage example, and exits with code `0`.
3. **AC-3 Version works**: Running `mic-tool --version` prints the semver from `package.json` and exits with code `0`.
4. **AC-4 Missing-key error**: Running the tool with no API key in env, no `.env` file, and no `--api-key` flag exits with a non-zero code and prints a clear, named error to `stderr` (e.g. `MissingConfigurationError: SONIOX_API_KEY is not set...`). No partial mic capture occurs.
5. **AC-5 Live transcription**: With a valid API key supplied via env, the tester speaks a known sentence ("the quick brown fox jumps over the lazy dog") into the default mic, and within 2 seconds of finishing the sentence a finalized line matching that sentence (case-insensitive, allowing minor ASR variance) appears on `stdout`.
6. **AC-6 Partials render live**: While the tester is still speaking a long sentence, partial transcript text is visibly updating on the current console line (via `\r` overwrite) — verifying that partials are being consumed and rendered.
7. **AC-7 Precedence honored**: When `SONIOX_API_KEY` is set in shell env AND a different (invalid) key is in local `.env` AND a valid key is passed via `--api-key`, the tool authenticates successfully (proving CLI flag wins). Repeating with only env + `.env` (no flag) authenticates with the `.env` key, proving `.env` wins over shell env.
8. **AC-8 Graceful Ctrl+C**: Pressing Ctrl+C during an active session causes the tool to log a shutdown message to `stderr`, flush any pending final transcript to `stdout`, close the Soniox WebSocket cleanly (no unhandled-rejection traces), and exit with code `0` within 1 second.
9. **AC-9 Mic-permission error**: When mic permission is denied at the OS level, the tool exits with a non-zero code and prints a clear, actionable error message instructing the user how to grant mic access in System Settings.
10. **AC-10 Network-failure error**: If the Soniox WebSocket cannot be reached (simulated via `/etc/hosts` block or by disabling networking after start), the tool surfaces a clear error to `stderr` and exits with a non-zero code; it does not hang indefinitely.
11. **AC-11 Invalid-key error**: With a syntactically valid but rejected API key, Soniox's auth failure is surfaced as a clear, named error on `stderr` with a non-zero exit code.
12. **AC-12 Pipe-friendly stdout**: Running `mic-tool > transcript.txt` produces a file containing only transcript text (no log noise, no ANSI carriage-return artifacts when `--output-mode append` or `--output-mode final-only` is selected).
13. **AC-13 Docs present**: `docs/design/project-design.md`, `docs/design/project-functions.md`, and a user-facing README (or `docs/design/configuration-guide.md` for the API-key precedence) all exist and are consistent with the implementation.
14. **AC-14 Tests present**: At least one integration-style test script under `test_scripts/` exercises the CLI's help/version/missing-key paths without requiring network or microphone access (these can be mocked).

## Assumptions

The following assumptions were made because the user could not be queried directly during refinement. The orchestrator/user should challenge any that are wrong before execution begins.

- **A-1 Soniox mode**: Real-time streaming WebSocket API is used (not batch). Basis: the raw request states "streaming the transcribed text to the console" and "listening to the microphone," which only makes sense with the real-time API.
- **A-2 Output rendering default**: Partial transcripts overwrite the current line via `\r`; finals commit to a new line. An `--output-mode` flag exposes `overwrite` (default), `append`, and `final-only`. Basis: best balance of readability vs. pipe-friendliness, with escape hatches for both extremes.
- **A-3 API key precedence**: CLI flag > local `.env` > shell env, with NO interactive prompt fallback (interactive prompts conflict with the "no fallback" rule and complicate piping). Basis: standard 12-factor-ish layering; flag-wins matches conventional CLI behavior.
- **A-4 Mic selection**: macOS default input device only in v1; no `--device` flag, no `--list-devices` subcommand. Basis: keeps v1 scope tight; isolating mic capture behind an interface (NFR-6) leaves room for v2 to add it.
- **A-5 Language**: `--language` flag defaults to `en`; if Soniox supports `auto`, that value is accepted. No `--model` flag in v1 (a sensible Soniox default model is hardcoded; expose later if needed). Basis: minimizes surface area while leaving the most-asked-for knob.
- **A-6 No transcript-file flag in v1**: Users can use shell redirection (`> file`) — combined with `--output-mode append` or `final-only` for clean output. Basis: avoids reinventing what shells already do well.
- **A-7 Package manager**: `pnpm` is the assumed package manager based on the dependency-vetting examples in `CLAUDE.md`. If the team prefers `npm` or `yarn`, the equivalent commands apply.
- **A-8 Audio format hypothesis**: 16-bit signed PCM, 16 kHz, mono, little-endian is the starting assumption for what Soniox real-time expects. The investigation phase MUST confirm against current Soniox docs and adjust before implementation.
- **A-9 Mic-capture library**: A concrete library choice (e.g. `node-record-lpcm16`, `mic`, or invoking `sox`/`ffmpeg` as a subprocess) is deferred to the investigation/planning phase. The dependency-vetting policy applies whichever route is chosen.
- **A-10 Binary name**: `mic-tool` is assumed as the CLI binary name (matches the project directory). The team may rename it before publishing.

## Open Questions

The following questions should be resolved during the investigation/planning phase, or escalated to the user if they remain blockers:

- **OQ-1 Soniox endpoint and auth specifics**: Exact WebSocket URL, auth-frame schema, supported audio encodings, and event/result schema — must be read from Soniox's current official documentation.
- **OQ-2 Soniox model selection**: Whether a specific model name needs to be sent in the config frame for English real-time, and whether multilingual/auto-detect requires a different model. Affects FR-8.
- **OQ-3 Keep-alive protocol**: Whether Soniox requires periodic ping/empty-audio frames during silence, or manages keep-alive itself. Affects FR-10 and reconnection logic.
- **OQ-4 Reconnect-on-drop policy**: Should the tool attempt to auto-reconnect on a transient network drop, or fail fast? v1 default proposed: fail fast with a clear error (AC-10); confirm with the user.
- **OQ-5 Mic-capture library choice**: To be decided in the investigation phase based on maintenance status, native-build complexity on Apple Silicon, and CVE history.

## Original Request

> I want you to create a command line tool capable of listening to the microphone and transcribing the input through the Soniox API.
> The user will provide the API key required by Soniox.
> The tool must stream the transcribed text to the console.
