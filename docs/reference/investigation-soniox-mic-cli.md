# Investigation: Soniox Microphone Live-Transcription CLI (`mic-tool-ts`)

## Executive Summary

Build the v1 CLI as a small TypeScript Node.js (>= 20) program that uses the **official `@soniox/node` SDK (v2.x)** for the Soniox real-time WebSocket session, and captures macOS microphone audio by **spawning the `sox` binary directly as a child process** (no Node mic wrapper package). The SDK collapses ~80% of the protocol surface (config frame, audio framing, keepalive, result events, finish/close) into well-typed methods and removes the need to take a direct dependency on `ws`/`undici`. Spawning `sox` directly avoids the two stale wrapper packages (`node-record-lpcm16`, `mic`) and the native-build pain of `naudiodon` on Apple Silicon, while still requiring zero compilation and zero new npm runtime deps for the audio path. Configure the session for `audio_format: "pcm_s16le"`, `sample_rate: 16000`, `num_channels: 1`, `model: "stt-rt-v4"`, with `enable_endpoint_detection: true`. Use **Commander** for CLI flags and the **Node-native `--env-file` flag plus `process.loadEnvFile()`** for `.env` loading (no `dotenv` dependency).

The recommendation prioritizes minimum runtime-dependency surface area, strong typings, and clean Apple Silicon support — directly aligning with the dependency-vetting policy and NFR-6 (isolating mic capture behind an interface).

## Context

- Refined request: `/Users/giorgosmarinos/aiwork/coding-platform/mic-tool-ts/docs/design/refined-request-soniox-mic-transcriber.md`
- Goal: a single TypeScript CLI binary (`mic-tool-ts`) that captures macOS mic audio, streams it to Soniox real-time WSS, and renders partial + final transcripts to `stdout`.
- Hard constraints recap:
  - TypeScript only, Node.js LTS (>= 20).
  - macOS (Darwin) v1 only; mic-capture layer must be abstracted for future Linux/Windows.
  - pnpm package manager; `mic-tool-ts` binary name; fail-fast on WS drop (no reconnect in v1).
  - No fallback config values; API key precedence is CLI flag > local `.env` > shell env.
  - Dependency vetting required for every new runtime dep; prefer latest non-vulnerable major; audit must be clean.
- 14 acceptance criteria already drive the implementation contract; this investigation only resolves the *how*.

## Findings by Topic

### 1. Soniox real-time WebSocket protocol (resolves OQ-1, OQ-2, OQ-3)

Confirmed from the official Soniox docs (May 2026) and the `@soniox/node` SDK README:

- **Endpoint URL**: `wss://stt-rt.soniox.com/transcribe-websocket` (overridable via `SONIOX_WS_URL`). Regional variants are exposed via `region: 'eu' | 'jp'` or `SONIOX_BASE_DOMAIN`.
- **Authentication**: API key is sent inside the **first JSON configuration frame** as the `api_key` field — NOT as an HTTP header and NOT as a query parameter. (Temporary API keys are an alternative for client-side use; not relevant for a server-/CLI-side tool that already has the long-lived key.)
- **Initial config frame schema** (sent as a single JSON text frame immediately after the WS opens):
  ```json
  {
    "api_key": "<SONIOX_API_KEY>",
    "model": "stt-rt-v4",
    "audio_format": "pcm_s16le",
    "sample_rate": 16000,
    "num_channels": 1,
    "language_hints": ["en"],
    "enable_endpoint_detection": true,
    "max_endpoint_delay_ms": 2000
  }
  ```
  - `audio_format` accepts `"auto"` (let Soniox sniff container headers) or a raw PCM tag such as `pcm_s8`, `pcm_s16le`, `pcm_s16be`, `pcm_s24le/be`, `pcm_s32le/be`, the unsigned variants, `pcm_f32le/be`, `pcm_f64le/be`, plus companded `mulaw` / `alaw`. When a raw PCM format is chosen, `sample_rate` and `num_channels` are **required**.
  - The starting hypothesis in the spec (16-bit signed PCM, 16 kHz, mono, little-endian) is **confirmed correct** — the matching `audio_format` tag is `"pcm_s16le"`.
- **Audio framing**: Send audio as **binary WebSocket frames** of arbitrary chunk size. Each stream supports up to 300 minutes total.
- **Result event schema**: Server pushes JSON text frames of the form:
  ```json
  {
    "tokens": [
      { "text": "Hello", "start_ms": 600, "end_ms": 760, "confidence": 0.97, "is_final": true, "speaker": "1", "language": "en" }
    ],
    "final_audio_proc_ms": 760,
    "total_audio_proc_ms": 880
  }
  ```
  - Discrimination between partial and final is **per-token** via `is_final` boolean — not per-message. A single response may contain a mix.
  - Non-final tokens may be re-sent with refined text until they stabilize to `is_final: true`. Final tokens are emitted exactly once and never change.
  - `start_ms` / `end_ms` are token-level timestamps; `final_audio_proc_ms` and `total_audio_proc_ms` are session counters.
- **Models available**: `stt-rt-v4` is the current recommended real-time model (older `stt-rt-preview` and `stt-rt-preview-v2` are legacy). `stt-rt-v4` supports multilingual transcription with `language_hints: ["en", "es", ...]` and `enable_language_identification: true` for auto-detect-style behaviour. No separate "auto" model exists — auto-language identification is a flag on `stt-rt-v4`.
- **Keep-alive (OQ-3)**: Soniox supports an explicit `{"type":"keepalive"}` JSON text frame. The `@soniox/node` SDK sends one every `keepalive_interval_ms` (default 5000 ms) automatically while the session is paused; for active sessions, audio frames themselves keep the socket alive, so no extra work is required. **The CLI does not have to implement keepalive manually if it uses the SDK.**
- **Manual finalization**: A `{"type":"finalize"}` frame forces all pending non-final tokens to finalize immediately. Useful for `SIGINT` shutdown to drain partials cleanly.
- **End-of-stream signal**: Send an **empty WebSocket frame** (binary or text). The server returns a final "finished" response and closes the connection. The SDK exposes this as `session.finish()`.
- **Error response**: Single JSON message of the form `{ "tokens": [], "error_code": <int>, "error_message": "<str>" }` followed immediately by socket close. SDK surfaces this on `session.on("error", ...)`.
- **Rate limits / pricing**: Not architecturally significant for a single-mic CLI; per-stream cap is 300 minutes (~5 hours).
- **Reference implementation observed**: `agentvoiceresponse/avr-asr-soniox` is a third-party Node.js project that talks raw WebSocket to `wss://stt-rt.soniox.com/transcribe-websocket` with `pcm_s16le` audio — confirms the protocol details independently of the official docs.

### 2. macOS microphone capture (resolves OQ-5)

Candidates evaluated:

| Library | Backend | Last release | Apple Silicon (arm64) | Native build needed | CVE history (2024-26) | License | Notes |
|---|---|---|---|---|---|---|---|
| `node-record-lpcm16` | spawns `sox`/`rec` | ~7 years ago | Works (uses Homebrew SoX) | No | None directly; effectively unmaintained | MIT | Classic choice; abandoned; only ~63 dependents. Community fork `node-record-lpcm16-v2` is slightly fresher but still requires SoX. |
| `mic` / `node-microphone` | spawns `sox`/`arecord` | ~3 years ago | Works (uses Homebrew SoX) | No | None directly | MIT | Thin wrapper, also stale. |
| `naudiodon` / `naudiodon2` | PortAudio native binding (C++ via node-gyp) | sporadic | Requires arm64 rebuild; `naudiodon2` fork generally works | **Yes — needs Xcode CLT + `brew install portaudio`** | None recent, but PortAudio CVEs exist historically | MIT | Lowest latency, device enumeration, loopback. Heaviest install. |
| Spawn `sox` directly via `child_process.spawn` | SoX binary | n/a (no npm dep) | Works (Homebrew arm64 SoX) | No | n/a | n/a | Same backend as `node-record-lpcm16`, with zero npm runtime dependency. Full control of args. |
| Spawn `ffmpeg -f avfoundation` directly | ffmpeg binary | n/a | Works | No | n/a | n/a | Heavier binary; avfoundation API is macOS-native. Good Linux/Windows extensibility. |
| `micstream` (`@analyticsinmotion/micstream`) | Native PortAudio addon with prebuilt binaries | recent | Claims pre-built arm64 binaries | No (prebuilt) | New project, low adoption | check on install | Promising but unproven; small audience; would still need vetting. |
| Web Audio via `wrtc` / `mediasoup` | WebRTC stack | recent | Yes | Yes (`wrtc` is native) | Multiple historical CVEs in WebRTC stack | mixed | Massively overkill for mic-only capture; clearly inappropriate. |

**Recommendation: spawn `sox` (or `rec`) directly via `node:child_process`.** Rationale:

1. **Zero npm runtime dependency** for the mic path. The two wrapper packages (`node-record-lpcm16`, `mic`) are abandoned (7 and 3 years since last release) and provide only ~30 lines of glue we can write ourselves — which the dependency-vetting policy effectively penalizes them for.
2. **No native compilation.** `naudiodon` requires Xcode CLT + PortAudio + arm64 rebuild; SoX is pure binary from Homebrew (`brew install sox`).
3. **Direct format control.** Spawning `sox` with `-t raw -r 16000 -c 1 -b 16 -e signed-integer -L -` emits exactly `pcm_s16le` mono 16 kHz to stdout — exactly what Soniox wants, with no transformation step.
4. **Clean abstraction boundary for NFR-6.** A `MicSource` interface returning a `Readable<Buffer>` lets us swap in `arecord` (Linux) or `ffmpeg -f dshow` (Windows) later without touching the Soniox pipeline.
5. **No CVE inheritance.** SoX itself is system-managed via Homebrew; not in our supply chain.

The exact macOS spawn command:
```
sox -q -d -t raw -r 16000 -c 1 -b 16 -e signed-integer -L -
```
(`-d` selects the default input device → CoreAudio default mic; `-L` is little-endian.) Equivalent `rec` invocation also works.

Prerequisite documented in README: `brew install sox`. The CLI must detect a missing binary and emit a clear `MicBackendUnavailableError` pointing the user to the install command.

### 3. WebSocket client library

Candidates:
- **`ws` (v8.20.x)** — Battle-tested, used by ~31k projects, latest release within days, optional `bufferutil` acceleration, full feature surface.
- **Built-in `globalThis.WebSocket` (Undici-backed, stable since Node 22.4)** — Zero deps, standards-compliant, client-only (server not supported, but irrelevant here).
- **`undici` direct dependency** — Same code as built-in, pinnable to a newer version.

**Recommendation: use neither directly — depend on `@soniox/node` v2.x, which transitively handles WebSocket framing for us with zero declared dependencies (per its npm page, "0 Dependencies").** This is the strongest possible outcome under the dependency-vetting policy. If, after planning, we decide to hand-roll the protocol instead of using the SDK, prefer the built-in `WebSocket` global on Node 22 and fall back to `ws@^8` on Node 20.x where the built-in may not yet be stable for all use cases. There is no scenario in this CLI where `ws`'s server, compression, or extension features are needed.

### 4. CLI framework

Candidates:
- **Commander (v14.x)** — ~369M weekly downloads, zero deps, smallest API, decent built-in `--help`/`--version` support.
- **Yargs (v18.x)** — Richer feature set, larger dep tree, ~290 KB install. Overkill for ~6 flags.
- **CAC (v7.x)** — Lightweight, ~3K stars, clean API; smaller community than Commander.
- **Plain `process.argv` parsing** — Possible but `--help` ergonomics get tedious by AC-2.

**Recommendation: Commander v14.** Rationale: zero declared dependencies, the de-facto standard so future contributors recognize it, and its built-in `Command.helpInformation()` and `.version()` satisfy AC-2 and AC-3 with two lines of code each. CAC would also be acceptable but offers no decisive advantage and is less ubiquitous. Avoid Yargs's dependency footprint.

### 5. `.env` loading

Candidates:
- **Node-native `--env-file=.env` flag (Node 20.6+/22)** — Zero deps. Doesn't allow programmatic precedence handling on its own.
- **Node-native `process.loadEnvFile(path)` (Node 20.12+/22)** — Programmatic, zero deps, throws cleanly when file is missing.
- **`dotenv` (v16.x)** — Mature, ~45M weekly downloads, supports interpolation/expansion, but yet another runtime dependency.

**Recommendation: use Node-native `process.loadEnvFile()` (programmatic) plus the `--env-file` CLI flag is **not** appropriate here because we need a specific precedence order that Node's flag does not enforce.** Concretely:

1. Read `--api-key` from parsed args (highest priority). If present, use it.
2. Else, call `process.loadEnvFile(path.resolve('.env'))` inside a `try`/`catch`. If `.env` exists and defines `SONIOX_API_KEY`, the variable is now in `process.env` and overrides whatever the shell originally set (matching FR-5: local `.env` wins over shell env).
3. Else, fall back to `process.env.SONIOX_API_KEY` from the shell.
4. If still absent, throw `MissingConfigurationError` (no default permitted — NFR-5).

This satisfies the FR-5 precedence with **zero new runtime dependencies**. `dotenv` adds no functionality we need here. Verified: `process.loadEnvFile()` is available in Node 20.12+ and all Node 22.x — covered by the NFR-1 baseline.

### 6. Audio encoding pipeline

Because we spawn `sox` directly and instruct it to emit `pcm_s16le` mono 16 kHz on stdout (matching Soniox's `audio_format: "pcm_s16le"` + `sample_rate: 16000` + `num_channels: 1`), **no in-process audio transformation is required**. SoX does the resampling, mono-downmix, and little-endian packing. The Node.js code only needs to forward `Buffer` chunks from the spawn's stdout to `session.sendAudio(chunk)` (or pipe via `session.sendStream(child.stdout)`).

### 7. Reference implementations

- **Official `@soniox/node` SDK** — `client.realtime.stt({ model: 'stt-rt-v4', audio_format: 'pcm_s16le', sample_rate: 16000, num_channels: 1, enable_endpoint_detection: true, language_hints: ['en'] })` exposes `session.connect()`, `session.sendAudio(chunk)`, `session.sendStream(readable, { pace_ms?, finish })`, `session.finish()`, `session.pause() / .resume()` (with auto-keepalive while paused), and `session.on('result' | 'error' | 'endpoint' | ...)`. This is the cleanest integration path.
- **`soniox/soniox_examples`** (GitHub) — Official examples; the Node sample streams from `--audio_path` files via `sendStream`. Does not show mic input, but the result-handling code is directly reusable.
- **`agentvoiceresponse/avr-asr-soniox`** — Third-party Express-based proxy; raw-WebSocket implementation that confirms protocol behaviour (config frame with `api_key`, binary audio frames, `pcm_s16le` requirement, JSON token responses).

No existing open-source TypeScript mic-to-Soniox CLI was found. We will be the first reference implementation in this niche.

## Comparison Matrix

| Criterion | SDK + sox-spawn (recommended) | `@soniox/node` + `node-record-lpcm16` | `@soniox/node` + `naudiodon2` | Hand-rolled `ws` + spawn `sox` |
|---|---|---|---|---|
| Runtime npm deps added | 2 (`@soniox/node`, `commander`) | 3 | 3 | 3 (`ws`, `commander`, no SDK) |
| Native compilation | No | No | **Yes (PortAudio + node-gyp)** | No |
| Apple Silicon ease | Excellent | Good | Risky | Excellent |
| Maintenance of mic dep | n/a (system binary) | **Abandoned 7y** | Sporadic | n/a |
| Latency overhead | Low (subprocess pipe) | Low | Lowest (direct CoreAudio) | Low |
| Soniox protocol drift risk | Low (SDK absorbs) | Low (SDK absorbs) | Low (SDK absorbs) | Medium (we maintain) |
| Keepalive handling | SDK auto | SDK auto | SDK auto | We must implement |
| Type-safety of API | Strong (SDK ships .d.ts) | Strong | Strong | We must write types |
| Linux/Windows extensibility (NFR-6) | Easy (swap spawn cmd) | Lib partially supports | Lib supports | Easy |
| Complexity / LOC | Lowest | Low | Low (after build works) | Highest |
| Dependency-vetting friction | Lowest | Mic dep is stale = flag | Native build = flag | Hand-rolled = more code to vet |

## Recommendation

**Adopt the SDK + sox-spawn stack:**

- `@soniox/node@^2` for the Soniox session (config frame, audio framing, result events, finish/keepalive).
- `commander@^14` for CLI flag parsing.
- Node-native `process.loadEnvFile()` for `.env` (no `dotenv`).
- `node:child_process.spawn('sox', [...])` for mic capture, hidden behind a `MicSource` interface so a future `arecord` / `ffmpeg` backend can replace it without touching the transcription pipeline.

**Why this beats alternatives:**

1. The SDK collapses the entire Soniox protocol surface (auth frame, audio framing, keepalive, finish, error mapping) into typed methods — eliminating 100+ lines of WebSocket plumbing we would otherwise own and need to maintain across protocol changes.
2. Spawning `sox` directly removes the two stale npm wrappers (`node-record-lpcm16`, `mic`) and the native-build hazard of `naudiodon` — net dependency count and audit-surface are minimal.
3. Both `@soniox/node` (0 deps per its npm metadata) and `commander` (0 deps) score perfectly under the project's dependency-vetting policy; no transitive surprises.
4. The mic-capture abstraction (`MicSource` interface returning a `Readable<Buffer>`) trivially generalizes to Linux (`arecord` or `sox` on ALSA) and Windows (`ffmpeg -f dshow`) per NFR-6, with no rewrite of the Soniox layer.
5. Pre-installed external tooling (`sox` via Homebrew) is acceptable for a developer-facing CLI and is the same UX as `node-record-lpcm16` would have demanded anyway.

**The recommendation would change if:**

- The SDK's audit/vetting check turns up a HIGH-or-above advisory at install time — fall back to hand-rolled `ws` client.
- The user demands a "no system dependency" install (no Homebrew SoX) — switch to `micstream` (pending its own vetting), accepting it as a less-proven option.
- The user wants device enumeration / system-audio loopback in v1 — adopt `naudiodon2` despite the Apple Silicon build cost.

**Prerequisites/caveats:**

- README must instruct users to `brew install sox` and to grant terminal-app mic permission in System Settings → Privacy & Security → Microphone (AC-9).
- The `mic-tool-ts` process inherits mic permission from its parent terminal; this is the standard macOS behaviour and the cause of most first-run "no audio" complaints.
- On `SIGINT`, the shutdown order must be: (1) stop `sox` child process, (2) call `session.finish()` to send the end-of-stream frame and drain finals, (3) close the WebSocket, (4) exit 0 — matches AC-8.

## Technical Research Guidance

**Research needed: Yes** — one focused deep dive before implementation.

### Topic 1: `@soniox/node` SDK v2 — real-time session lifecycle and event surface
- **Why**: The recommendation hinges on the SDK handling auth, keepalive, finalization, error mapping, and graceful close correctly. Before locking the design, the planner/implementer needs the exact TypeScript signatures, event payload shapes, and behaviour under edge conditions (network drop, invalid key, mic stall, SIGINT mid-utterance) so that AC-8, AC-10, AC-11 can be wired without guesswork.
- **Focus**:
  - Exact constructor options for `SonioxNodeClient` (full `SonioxNodeClientOptions` type) and `client.realtime.stt(...)` (real-time session options).
  - Methods: `connect()`, `sendAudio(Buffer)`, `sendStream(Readable, { pace_ms?, finish })`, `finish()`, `pause()`, `resume()`, `close()` / `destroy()` — their precise semantics and return types.
  - Event surface: full list (`result`, `error`, `endpoint`, `finished`, `closed`, ...) with payload schemas — especially how `is_final` tokens are grouped into "endpoint" / utterance events vs raw token streams.
  - Error class taxonomy (e.g. `SonioxHttpError`, any `SonioxWebSocketError`) and which `error_code` values map to "auth failure" (AC-11) vs "connection failure" (AC-10).
  - Behaviour on WebSocket abrupt close (server-side or network-side) given v1's fail-fast policy.
  - Confirmation that `@soniox/node@^2` truly declares 0 runtime deps (per npm metadata) and that `pnpm audit` is clean against the version we pin.
- **Depth**: Intermediate — enough to drive the implementation, but no need to read the full SDK source unless inconsistencies surface.
- **Relevance**: Directly governs how the CLI handles all four runtime error ACs (AC-8 graceful Ctrl+C, AC-9 mic-permission, AC-10 network, AC-11 invalid key) and FR-7 / FR-10. Without it, the planner would be guessing at the SDK's contract.

No further research is needed on the mic-capture layer, CLI framework, or `.env` loading — those are settled here.

## Implementation Considerations

- **Key decisions still to be made (defer to planning/design phase):**
  - Whether the `MicSource` interface emits raw `Buffer` chunks or a `Readable` stream (the SDK accepts both; a `Readable` is slightly simpler for piping but a buffer-callback is easier to mock in unit tests for AC-14).
  - Whether to expose `--keepalive-interval-ms` as a hidden flag for ops debugging (probably not in v1).
  - Whether to log Soniox `total_audio_proc_ms` periodically under `--verbose` (recommended — useful diagnostic).
  - How to render `is_final` mixed-token responses under `--output-mode overwrite`: the simplest rule is "rewrite the current line each response, then on receipt of any `is_final` token, commit the pending finals to a new line." This needs to be specified by the designer.

- **Dependencies / prerequisites:**
  - `brew install sox` on every dev/test machine.
  - macOS mic permission granted to the terminal app running `mic-tool-ts`.
  - Soniox account + API key for end-to-end manual tests; mocked SDK for AC-14 unit tests.
  - Node.js >= 20.12 (required for `process.loadEnvFile`).

- **Potential pitfalls:**
  - Spawning `sox` with the wrong endianness flag (`-L` vs `-B`) will produce garbage tokens — must lock to `-L` and assert via a test that the first byte pattern matches a known sine wave (or just integration-test).
  - SoX's `-d` (default device) honors CoreAudio's current default — if the user switches input device mid-session, behaviour is undefined; document as a known limitation.
  - Killing the `sox` child on `SIGINT` before `session.finish()` may discard the last buffered audio chunks; sequence the shutdown carefully (stop sox, await pending writes drained, then finish session).
  - The CLI must NOT pipe `sox`'s stderr to our `stderr` raw — SoX emits progress noise that would pollute logs. Drop it under non-verbose mode; surface it only with `--verbose`.
  - macOS terminal must have Microphone permission; the OS-level denial often surfaces as a non-obvious sox error rather than a clean ENOENT — add explicit detection in `MicSource` to map this to `MicPermissionError` (AC-9).

- **Suggested first steps:**
  1. Scaffold `pnpm` workspace with `typescript`, `@soniox/node`, `commander`, `tsx`, `vitest`, `@types/node`. Run `pnpm audit` and confirm zero HIGH+ advisories. Record vetted-on dates in `Issues - Pending Items.md` per policy.
  2. Write the `MicSource` interface and the macOS `SoxMicSource` implementation; test it standalone by writing N seconds of audio to a `.raw` file and playing it back with `play -t raw -r 16000 -c 1 -b 16 -e signed-integer -L file.raw`.
  3. Wire the Soniox session with hardcoded args; speak the AC-5 test sentence and confirm tokens come back.
  4. Layer in Commander, env/file/flag precedence, output modes, and error mapping.
  5. Write the AC-14 integration test scripts under `test_scripts/` using mocked SDK + mocked `MicSource`.

## References

| # | Source | URL | What was learned |
|---|---|---|---|
| 1 | Soniox WebSocket API reference | https://soniox.com/docs/stt/api-reference/websocket-api | Endpoint `wss://stt-rt.soniox.com/transcribe-websocket`, full config-frame schema, `audio_format` values, token-level `is_final`, empty-frame end-of-stream, error-message shape |
| 2 | Soniox real-time transcription guide | https://soniox.com/docs/stt/rt/real-time-transcription | Current model `stt-rt-v4`, endpoint detection, manual finalization, keepalive semantics |
| 3 | Soniox Node SDK docs | https://soniox.com/docs/stt/SDKs/node-SDK | `SonioxNodeClient` env-var fallbacks, region/base-domain resolution, error classes |
| 4 | Soniox Node SDK real-time docs | https://soniox.com/docs/sdk/node-SDK/stt/realtime-transcription | `client.realtime.stt({...})` options including `audio_format: 'pcm_s16le'`, `sendAudio`, `sendStream`, `pause`/`resume` with auto-keepalive |
| 5 | `@soniox/node` on npm | https://www.npmjs.com/package/@soniox/node | Current version 2.0.3, MIT, 0 declared dependencies, published 11 days ago |
| 6 | `soniox/soniox_examples` GitHub | https://github.com/soniox/soniox_examples | Official Node SDK examples (file-source); confirms idiomatic SDK usage |
| 7 | `agentvoiceresponse/avr-asr-soniox` | https://github.com/agentvoiceresponse/avr-asr-soniox | Third-party raw-WebSocket Node implementation confirming `pcm_s16le` + auth-frame protocol details |
| 8 | `node-record-lpcm16` npm | https://www.npmjs.com/package/node-record-lpcm16 | Last release ~7 years ago; requires SoX in PATH; uses 16 kHz mono PCM defaults |
| 9 | `node-record-lpcm16` GitHub | https://github.com/gillesdemey/node-record-lpcm16 | Source confirms SoX subprocess wrapper, 30-line core implementation |
| 10 | `mic` / `node-microphone` npm | https://www.npmjs.com/package/node-microphone | Last release ~3 years ago; SoX/arecord wrapper |
| 11 | `micstream` | https://micstream.dev/ | PortAudio native addon with prebuilt arm64 binaries; new project |
| 12 | `ws` npm | https://www.npmjs.com/package/ws | v8.20.x current; 0-dep core; recommended for WS server use; client-only use is now covered by Node native WebSocket |
| 13 | Node.js native WebSocket (Undici) | https://nodejs.org/learn/getting-started/websocket | Built-in global `WebSocket` client stable since Node 22.4 |
| 14 | Commander npm | https://www.npmjs.com/package/commander | v14.x, 0 deps, ~369M weekly downloads, built-in help/version |
| 15 | Node `--env-file` / `process.loadEnvFile` blog | https://www.dotenv.org/blog/2023/10/28/node-20-6-0-includes-built-in-support-for-env-files.html | Native `.env` support since Node 20.6; programmatic API since 20.12 |
| 16 | Stop-using-dotenv blog (Infisical) | https://infisical.com/blog/stop-using-dotenv-in-nodejs-v20.6.0+ | Trade-offs and limitations of native `--env-file` vs `dotenv` |
| 17 | Node.js spawn sox/ffmpeg recipe | https://www.codelessgenie.com/blog/capture-system-audio-output-with-nodejs/ | Concrete `child_process.spawn` invocations for SoX and ffmpeg-avfoundation emitting `pcm_s16le` mono 16 kHz on stdout |
| 18 | naudiodon notes | (PortAudio binding context, multiple sources above) | Native compilation required; Apple Silicon historically fragile; `naudiodon2` fork preferred when used |

## Original Request

See refined specification at `/Users/giorgosmarinos/aiwork/coding-platform/mic-tool-ts/docs/design/refined-request-soniox-mic-transcriber.md` (scope, 10 FRs, 7 NFRs, 14 ACs, 10 assumptions, 5 open questions OQ-1..OQ-5).

Raw request preserved at line 124 of the refined spec:
> I want you to create a command line tool capable of listening to the microphone and transcribing the input through the Soniox API. The user will provide the API key required by Soniox. The tool must stream the transcribed text to the console.


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
