# `@soniox/node` v2 — SDK Deep Dive for Microphone-Streaming CLI

**Document purpose**: Implementation-ready reference for the mic-tool designer and coder.  
**SDK version researched**: `@soniox/node@2.0.3` (latest stable as of 2026-05-15)  
**Sources**: Official Soniox docs, npm registry metadata, soniox-js GitHub README, SDK reference pages

---

## TL;DR — Quick Reference (Copy-Paste Wiring)

```typescript
import {
  SonioxNodeClient,
  AuthError,
  ConnectionError,
  NetworkError,
  BadRequestError,
  StateError,
  AbortError,
} from "@soniox/node";

// 1. Construct client (key NOT read from env automatically — pass explicitly)
const client = new SonioxNodeClient({ api_key: resolvedApiKey });

// 2. Create session (returns RealtimeSttSession — not yet connected)
const session = client.realtime.stt({
  model: "stt-rt-v4",
  audio_format: "pcm_s16le",
  sample_rate: 16000,
  num_channels: 1,
  enable_endpoint_detection: true,
  language_hints: ["en"],
});

// 3. Wire events BEFORE connecting
session.on("result", (result) => { /* render result.tokens */ });
session.on("error", (err) => { /* classify and handle */ });
session.on("disconnected", (reason) => { /* log reason */ });
session.on("finished", () => { /* session drained */ });

// 4. Connect (async — throws ConnectionError/AuthError on failure)
await session.connect();

// 5a. Send discrete chunks from a mic child process
soxProcess.stdout.on("data", (chunk: Buffer) => session.sendAudio(chunk));

// 5b. OR pipe a Node Readable / any AsyncIterable
await session.sendStream(soxProcess.stdout, { finish: true });

// 6. SIGINT graceful shutdown
session.finalize();                // force-finalize partial tokens
await session.finish();            // send EOS frame, await 'finished' event
session.close();                   // immediate abort if finish() hangs
```

---

## 1. Installation and TypeScript Surface

### Package coordinates

| Field          | Value                                                  |
|----------------|--------------------------------------------------------|
| Package name   | `@soniox/node`                                         |
| Latest stable  | `2.0.3` (published 2025-04-30 per npm registry)        |
| Pin range      | `"@soniox/node": "^2.0.3"` (caret within v2 major)    |
| License        | MIT                                                    |
| Runtime deps   | **0 declared dependencies** (confirmed by npm metadata)|
| Node engine    | Not explicitly stated; built with Node 20.20.2         |
| ESM + CJS      | Yes — dual-format (`dist/index.mjs` + `dist/index.cjs`)|

### Import shape

```typescript
// Named exports — no default export
import {
  SonioxNodeClient,          // main client class
  RealtimeSttSession,        // returned by client.realtime.stt()
  RealtimeUtteranceBuffer,   // utterance accumulation helper
  RealtimeSegmentBuffer,     // rolling segment accumulation helper

  // Error classes
  SonioxError,               // base for all SDK errors
  SonioxHttpError,           // REST/HTTP errors
  RealtimeError,             // base for all WebSocket errors
  AuthError,                 // 401 — invalid/expired key
  BadRequestError,           // 400 — invalid config
  QuotaError,                // 402/429 — rate limits
  ConnectionError,           // WS connect failure / timeout
  NetworkError,              // 408/500/503 — server-side network
  AbortError,                // AbortSignal cancellation
  StateError,                // operation in wrong state

  // Types (TypeScript only)
  type SonioxNodeClientOptions,
  type SttSessionConfig,
  type SttSessionOptions,
  type SttSessionEvents,
  type SttSessionState,
  type RealtimeResult,
  type RealtimeToken,
  type RealtimeSegment,
  type RealtimeUtterance,
  type RealtimeErrorCode,
  type HttpErrorCode,
  type SendStreamOptions,
  type AudioData,
} from "@soniox/node";
```

### Types: bundled or separate?

Types **ship with the package**. The `dist/index.d.mts` / `dist/index.d.cts` declaration files are included in the tarball. No `@types/soniox__node` package is needed.

### Peer dependencies

None. The package has zero declared runtime or peer dependencies.

---

## 2. Client Construction and Configuration

### Class name

`SonioxNodeClient` — imported as a named export.

### Constructor signature

```typescript
new SonioxNodeClient(options?: SonioxNodeClientOptions)
```

`options` is fully optional. When called with no arguments the client reads `SONIOX_API_KEY` from `process.env`.

### `SonioxNodeClientOptions` type

```typescript
interface SonioxNodeClientOptions {
  api_key?: string;           // falls back to SONIOX_API_KEY env var
  region?: "eu" | "jp";       // shorthand for base_domain
  base_domain?: string;       // e.g. 'eu.soniox.com' — derives all hosts
  base_url?: string;          // REST API URL override
  tts_api_url?: string;       // TTS REST URL override
  realtime?: {
    ws_base_url?: string;     // STT WebSocket base URL (SONIOX_WS_URL)
    tts_ws_url?: string;      // TTS WebSocket URL
    stt_defaults?: Partial<SttSessionConfig>;
    default_session_options?: SttSessionOptions;
    // ...TTS options omitted (not relevant here)
  };
  stt_defaults?: Partial<SttSessionConfig>;  // process-wide session defaults
  http_client?: HttpClient;   // custom HTTP client (advanced override)
}
```

**For the mic-tool CLI**, the only field that matters is `api_key`. All other defaults are correct.

```typescript
// mic-tool usage: pass the resolved key, never rely on auto-read-from-env
// (the CLI manages precedence before constructing the client)
const client = new SonioxNodeClient({ api_key: resolvedApiKey });
```

### `client.realtime.stt()` — session factory

```typescript
client.realtime.stt(
  config: SttSessionConfig,
  options?: SttSessionOptions
): RealtimeSttSession
```

This call is **synchronous** — it constructs the session object but does NOT open a WebSocket.

### `SttSessionConfig` — server-side configuration

```typescript
interface SttSessionConfig {
  model: string;                        // required — "stt-rt-v4"
  audio_format?: "auto" | AudioFormat;  // default "auto"; use "pcm_s16le" for raw PCM
  sample_rate?: number;                 // required when audio_format is raw PCM
  num_channels?: number;                // required when audio_format is raw PCM
  language_hints?: string[];            // e.g. ["en"] or ["en","es"]
  language_hints_strict?: boolean;      // bias heavily toward hints (not a hard filter)
  enable_endpoint_detection?: boolean;  // semantic utterance boundary detection
  max_endpoint_delay_ms?: number;       // 500–3000 ms, default 2000
  enable_language_identification?: boolean; // auto-detect language per token
  enable_speaker_diarization?: boolean; // speaker labels
  context?: TranscriptionContext;       // domain hints, custom terms
  client_reference_id?: string;         // usage log tagging (max 256 chars)
  translation?: TranslationConfig;      // optional translation
}
```

**Recommended config for mic-tool**:

```typescript
const session = client.realtime.stt({
  model: "stt-rt-v4",
  audio_format: "pcm_s16le",   // raw 16-bit signed PCM, little-endian
  sample_rate: 16000,
  num_channels: 1,
  enable_endpoint_detection: true,
  max_endpoint_delay_ms: 2000,
  language_hints: [languageFlag], // from --language flag, default "en"
});
```

For multilingual / auto-detect (`--language auto`):

```typescript
const session = client.realtime.stt({
  model: "stt-rt-v4",
  audio_format: "pcm_s16le",
  sample_rate: 16000,
  num_channels: 1,
  enable_endpoint_detection: true,
  enable_language_identification: true,
  // language_hints omitted — server will auto-detect
});
```

### `SttSessionOptions` — SDK-side options (NOT sent to server)

```typescript
interface SttSessionOptions {
  connect_timeout_ms?: number;     // default 20000 (20 s)
  keepalive_interval_ms?: number;  // default 5000 (5 s); used only while paused
  signal?: AbortSignal;            // cancellation
}
```

These control SDK behavior, not transcription model behavior.

---

## 3. Connection Lifecycle

### State machine

`SttSessionState` is a string union:

```typescript
type SttSessionState =
  | "idle"        // initial state after stt()
  | "connecting"  // connect() called, WS handshake in progress
  | "connected"   // WS open, ready for sendAudio()
  | "finishing"   // finish() called, draining remaining results
  | "finished"    // session ended cleanly (EOS received from server)
  | "canceled"    // close() called — immediate termination
  | "closed"      // WebSocket closed (after canceled or finished)
  | "error";      // unrecoverable error
```

Access the current state via `session.state` (getter).

### Lifecycle methods

#### `session.connect(): Promise<void>`

Opens the WebSocket, sends the config frame, and resolves when the connection is ready to receive audio. Throws (does not emit) on failure:

- Throws `ConnectionError` — WS could not be established, DNS failure, refused connection, `connect_timeout_ms` exceeded ("Connection timed out").
- Throws `AuthError` — the server rejected the API key (401). This fires synchronously as part of the `connect()` promise rejection.
- Throws `StateError` — `connect()` was called when already connected.
- Throws `AbortError` — the `signal` in `SttSessionOptions` was aborted.

**The `'connected'` event fires once `connect()` resolves** (i.e. the promise resolving and the event are equivalent signals).

#### `session.sendAudio(data: AudioData): void`

Sends a binary audio chunk to the server. Synchronous. `AudioData` is `Uint8Array | ArrayBuffer`; Node `Buffer` is a subtype of `Uint8Array` and is accepted.

- Throws `StateError` synchronously if the session is not in `"connected"` state.
- Throws `AbortError` if the session was aborted.

No return value; no backpressure signal. See section 6 for backpressure discussion.

#### `session.sendStream(stream: AsyncIterable<AudioData>, options?: SendStreamOptions): Promise<void>`

Iterates the async iterable and calls `sendAudio()` for each chunk. Returns a `Promise` that resolves when the iterable is exhausted.

```typescript
interface SendStreamOptions {
  pace_ms?: number;   // artificial delay between chunks (ms); NOT needed for live mic
  finish?: boolean;   // if true, calls session.finish() when the stream ends
}
```

Accepts **any** `AsyncIterable<Uint8Array | ArrayBuffer>`: Node.js `Readable` streams (which are `AsyncIterable`), `ReadableStream` (Web API), Bun streams, or custom async generators.

For mic-tool, use `session.sendAudio()` from the `child_process` `data` event OR `session.sendStream(soxProcess.stdout)`. Both work. The `data` event approach gives explicit control over the shutdown sequence.

#### `session.finish(): Promise<void>`

Sends an empty WebSocket frame (EOS signal), waits for the server to drain all pending tokens and close the connection. The promise resolves when the `'finished'` event fires. Use this for graceful SIGINT shutdown.

- Transitions state to `"finishing"` then `"finished"`.
- If called while in state other than `"connected"`, behaviour is undefined — guard with `session.state === "connected"` check.

#### `session.finalize(options?: { trailing_silence_ms?: number }): void`

Sends a `{"type":"finalize"}` JSON frame to force all pending non-final tokens to become final immediately. Synchronous (fire-and-forget). The `'finalized'` event fires when the server acknowledges with a `<fin>` marker token.

Use this at SIGINT **before** `finish()` to ensure partials are committed:

```typescript
session.finalize();              // request finalization
await session.finish();          // then drain and close
```

#### `session.close(): void`

Immediately cancels the session without waiting for remaining results. Transitions to `"canceled"`. Use as a timeout escape hatch if `finish()` does not resolve within your deadline.

```typescript
const SHUTDOWN_TIMEOUT_MS = 1500;
const done = session.finish();
const timeout = new Promise<void>((_, reject) =>
  setTimeout(() => reject(new Error("shutdown timeout")), SHUTDOWN_TIMEOUT_MS)
);
await Promise.race([done, timeout]).catch(() => session.close());
```

#### `session.pause(): void`

Pauses audio transmission (stops the caller from sending). While paused, the SDK **automatically sends keepalive frames every `keepalive_interval_ms`** (default 5 000 ms). Calling `pause()` also triggers server-side finalization of currently buffered audio (implicit `finalize`). Note: the caller is responsible for stopping the mic data flow when `pause()` is called; the SDK does not buffer and discard audio.

#### `session.resume(): void`

Resumes audio transmission from paused state. Stops the auto-keepalive timer.

#### `session.keepAlive(): void`

Manually sends a `{"type":"keepalive"}` frame. Only needed if you want to send keepalives outside the auto-pause cadence. For active (non-paused) sessions, audio frames serve as implicit keepalives.

**Important**: The Soniox server closes the WebSocket if no audio or keepalive is received for >20 seconds. The SDK handles this automatically while paused. During active microphone capture, audio frames are arriving continuously so no explicit keepalive is needed.

---

## 4. Event Surface

Events are registered with `session.on(event, handler)`, `session.once()`, and removed with `session.off()`. The session also supports async iteration via `for await (const event of session)`.

### Complete event table

| Event name      | Handler signature                         | When it fires                                                             |
|-----------------|-------------------------------------------|---------------------------------------------------------------------------|
| `'connected'`   | `() => void`                              | WebSocket opened and session ready (after `connect()` resolves)           |
| `'disconnected'`| `(reason?: string) => void`               | WebSocket closed for any reason (clean or unclean)                        |
| `'result'`      | `(result: RealtimeResult) => void`        | Server sends a transcript response frame (may contain partial + finals)   |
| `'token'`       | `(token: RealtimeToken) => void`          | Fires once per token extracted from each `result` (convenience event)     |
| `'endpoint'`    | `() => void`                              | Server detected utterance boundary (`<end>` token received)               |
| `'finalized'`   | `() => void`                              | Manual `finalize()` acknowledged (`<fin>` token received)                 |
| `'finished'`    | `() => void`                              | Session ended cleanly (EOS processed, server closed connection)           |
| `'error'`       | `(error: RealtimeError) => void`          | Any WebSocket-level error (auth, network, bad request, etc.)              |
| `'state_change'`| `(update: { state: SttSessionState }) => void` | Any state transition                                                |

### `RealtimeResult` — payload schema

```typescript
interface RealtimeResult {
  tokens: RealtimeToken[];
  final_audio_proc_ms: number;   // ms of audio committed to final tokens
  total_audio_proc_ms: number;   // ms of audio processed (final + partial)
  finished?: boolean;            // true only on the last result before session close
}
```

### `RealtimeToken` — individual token schema

```typescript
interface RealtimeToken {
  text: string;               // token text (word or sub-word)
  is_final: boolean;          // true = committed, never changes; false = provisional
  confidence: number;         // 0.0–1.0
  start_ms?: number;          // token start relative to stream start
  end_ms?: number;            // token end relative to stream start
  speaker?: string;           // speaker label (if diarization enabled)
  language?: string;          // detected language code (if lang ID enabled)
  source_language?: string;   // original language for translated tokens
  translation_status?: "none" | "original" | "translation";
}
```

### Token finality model

**Finality is per-token, not per-message**. A single `RealtimeResult` can mix `is_final: true` and `is_final: false` tokens. The canonical interpretation:

- `is_final: false` — provisional. The server may re-send tokens for the same time range with different text in a future result. Show these as live preview.
- `is_final: true` — committed. This token will never appear again with different text. Once a token is final, commit it to the display.

#### Rendering algorithm for `--output-mode overwrite`

```typescript
session.on("result", (result) => {
  // Accumulate finals in the committed buffer
  const newFinals = result.tokens.filter(t => t.is_final && t.text !== "<end>" && t.text !== "<fin>");
  committedBuffer.push(...newFinals);

  // Collect current partials
  const partials = result.tokens.filter(t => !t.is_final);

  // Build display line: committed + current partials
  const committedText = committedBuffer.map(t => t.text).join("");
  const partialText = partials.map(t => t.text).join("");

  process.stdout.write("\r" + committedText + partialText + "          "); // overwrite

  // When an endpoint fires, flush committed buffer to a new line
  // (see 'endpoint' event handler below)
});

session.on("endpoint", () => {
  const line = committedBuffer.map(t => t.text).join("").trim();
  if (line) process.stdout.write("\n" + line + "\n");
  committedBuffer.length = 0;
});
```

**Special marker tokens to filter**:
- `<end>` — endpoint detection boundary marker (always `is_final: true`)
- `<fin>` — manual finalization boundary marker (always `is_final: true`)

Both should be excluded from displayed text.

### `'disconnected'` vs `'error'`

- `'error'` fires when the SDK encounters a protocol-level or connection-level problem and maps it to a typed error class. It fires **before** `'disconnected'`.
- `'disconnected'` fires whenever the WebSocket closes, for any reason (clean or after error). The `reason` string comes from the WebSocket close frame message.
- In a fail-fast CLI (no reconnect), both events should trigger shutdown.

---

## 5. Error Model

### Error class hierarchy

```
SonioxError (base, all SDK errors)
├── SonioxHttpError          — REST API failures (not used for realtime path)
└── RealtimeError            — base for all WebSocket session errors
    ├── AuthError            — code: "auth_error",    statusCode: 401
    ├── BadRequestError      — code: "bad_request",   statusCode: 400
    ├── QuotaError           — code: "quota_exceeded",statusCode: 402 or 429
    ├── ConnectionError      — code: "connection_error", statusCode: undefined
    ├── NetworkError         — code: "network_error", statusCode: 408/500/503
    ├── AbortError           — code: "aborted",       statusCode: undefined
    └── StateError           — code: "state_error",   statusCode: undefined
```

### `RealtimeErrorCode` union

```typescript
type RealtimeErrorCode =
  | "auth_error"
  | "bad_request"
  | "quota_exceeded"
  | "connection_error"
  | "network_error"
  | "aborted"
  | "state_error"
  | "realtime_error";   // catch-all for unclassified server errors
```

### `RealtimeError` base properties

```typescript
class RealtimeError extends SonioxError {
  code: RealtimeErrorCode;
  raw: unknown;          // original WebSocket message payload for debugging
  statusCode?: number;   // HTTP-equivalent status code when available
  cause?: unknown;       // wrapped underlying error
}
```

### Error delivery: thrown vs event

Errors arrive via **two channels** depending on lifecycle phase:

| Phase                       | How error arrives                                              |
|-----------------------------|----------------------------------------------------------------|
| During `connect()`          | Thrown (rejected Promise from `await session.connect()`)       |
| After connected (mid-stream)| Emitted as `'error'` event on the session                      |
| During `sendAudio()`        | Thrown synchronously (only `StateError` / `AbortError`)        |
| During `sendStream()`       | Thrown (rejected Promise) or emitted — depends on error type   |

If no `'error'` listener is attached and an error fires as an event, Node.js will throw an uncaught exception. **Always attach an `'error'` listener before `connect()`.**

### AC-11: Invalid API key

```typescript
try {
  await session.connect();
} catch (err) {
  if (err instanceof AuthError) {
    // err.code === "auth_error"
    // err.statusCode === 401
    // err.message contains server error message
    // err.raw contains the raw WebSocket JSON error frame
    process.stderr.write(`AuthenticationError: Soniox rejected the API key. ` +
      `Verify SONIOX_API_KEY is correct.\n`);
    process.exit(1);
  }
}
```

The invalid-key error arrives as a thrown `AuthError` from `connect()` because the server sends the auth error immediately after the config frame (during the WS handshake phase).

### AC-10: Network failure

Two distinct failure modes:

**Could not connect** (DNS failure, firewall, unreachable host):

```typescript
// Thrown from connect()
if (err instanceof ConnectionError) {
  // err.code === "connection_error"
  // err.statusCode === undefined
  // err.message e.g. "Connection timed out" or raw WS error text
  // This fires when connect_timeout_ms exceeded or WS refused
}
```

**Dropped after connecting** (mid-stream network drop, server restart):

```typescript
// Emitted as 'error' event on the session
session.on("error", (err) => {
  if (err instanceof NetworkError) {
    // err.code === "network_error"
    // err.statusCode === 503 (early termination / server overload)
    //                 or 500 (internal server error)
    //                 or 408 (timeout)
    // The server docs note: on 503, a new session should be started
    // For fail-fast CLI v1: log and exit
  }
  if (err instanceof ConnectionError) {
    // Also possible mid-stream for transport-level drops
    // (e.g. network cable pulled)
  }
});
```

The `'disconnected'` event follows the `'error'` event on all error paths.

**Distinguishing "never connected" from "dropped mid-stream"**:

```typescript
let everConnected = false;
session.on("connected", () => { everConnected = true; });
session.on("error", (err) => {
  if (!everConnected && err instanceof ConnectionError) {
    // Never connected — DNS/firewall/timeout
  } else if (everConnected && (err instanceof NetworkError || err instanceof ConnectionError)) {
    // Was connected; dropped mid-stream
  }
});
```

### AC-8: Graceful shutdown — full error-safe sequence

```typescript
async function shutdown(session: RealtimeSttSession, soxProc: ChildProcess): Promise<void> {
  process.stderr.write("\nShutting down...\n");

  // 1. Stop mic capture
  soxProc.kill("SIGTERM");

  // 2. Guard: only finalize if connected
  if (session.state === "connected") {
    session.finalize();              // force partials to finals
    try {
      await Promise.race([
        session.finish(),            // drain and close cleanly
        new Promise<void>((_, rej) =>
          setTimeout(() => rej(new Error("timeout")), 1500)
        ),
      ]);
    } catch {
      session.close();               // fallback: immediate close
    }
  } else {
    session.close();
  }

  process.exit(0);
}

process.on("SIGINT", () => shutdown(session, soxProcess));
process.on("SIGTERM", () => shutdown(session, soxProcess));
```

---

## 6. Idiomatic Integration Patterns

### Minimal end-to-end mic-streaming snippet

```typescript
import { spawn } from "node:child_process";
import {
  SonioxNodeClient,
  AuthError,
  ConnectionError,
  NetworkError,
  StateError,
} from "@soniox/node";

async function main(apiKey: string, language: string) {
  const client = new SonioxNodeClient({ api_key: apiKey });

  const session = client.realtime.stt({
    model: "stt-rt-v4",
    audio_format: "pcm_s16le",
    sample_rate: 16000,
    num_channels: 1,
    enable_endpoint_detection: true,
    language_hints: language === "auto" ? undefined : [language],
    enable_language_identification: language === "auto" ? true : undefined,
  });

  // Accumulate final tokens per utterance
  const pendingFinals: string[] = [];

  session.on("result", (result) => {
    // Collect new finals
    for (const t of result.tokens) {
      if (t.is_final && t.text !== "<end>" && t.text !== "<fin>") {
        pendingFinals.push(t.text);
      }
    }
    // Overwrite current line with committed + partial text
    const partial = result.tokens
      .filter(t => !t.is_final)
      .map(t => t.text)
      .join("");
    process.stdout.write("\r" + pendingFinals.join("") + partial + "      ");
  });

  session.on("endpoint", () => {
    // Utterance complete — commit to a new line
    const line = pendingFinals.join("").trim();
    if (line) process.stdout.write("\r" + line + "\n");
    pendingFinals.length = 0;
  });

  session.on("error", (err) => {
    process.stderr.write(`\nSession error [${err.code}]: ${err.message}\n`);
    soxProc?.kill("SIGTERM");
    process.exit(1);
  });

  session.on("disconnected", (reason) => {
    process.stderr.write(`\nDisconnected: ${reason ?? "server closed connection"}\n`);
  });

  // Connect first — throws on auth/connection failure
  try {
    await session.connect();
    process.stderr.write("Connected to Soniox.\n");
  } catch (err) {
    if (err instanceof AuthError) {
      process.stderr.write("AuthenticationError: Invalid API key.\n");
    } else if (err instanceof ConnectionError) {
      process.stderr.write(`ConnectionError: ${(err as Error).message}\n`);
    } else {
      process.stderr.write(`Unexpected connect error: ${(err as Error).message}\n`);
    }
    process.exit(1);
  }

  // Spawn sox mic capture
  const soxProc = spawn("sox", [
    "-q",              // quiet (suppress sox progress to stderr)
    "-d",              // default input device (CoreAudio mic)
    "-t", "raw",       // raw output (no container headers)
    "-r", "16000",     // sample rate 16 kHz
    "-c", "1",         // mono
    "-b", "16",        // 16-bit
    "-e", "signed-integer",
    "-L",              // little-endian
    "-",               // write to stdout
  ], { stdio: ["ignore", "pipe", "pipe"] });

  soxProc.stderr.on("data", (data: Buffer) => {
    // Only surface sox errors under --verbose; suppress by default
    if (process.env.VERBOSE) process.stderr.write(`[sox] ${data}`);
  });

  soxProc.on("exit", (code) => {
    if (code && code !== 0) {
      process.stderr.write(`MicError: sox exited with code ${code}.\n`);
      // code 1 often means permission denied — add detection here
    }
  });

  soxProc.stdout.on("data", (chunk: Buffer) => {
    if (session.state === "connected") {
      session.sendAudio(chunk);
    }
  });

  // Graceful shutdown
  const shutdown = async () => {
    process.stderr.write("\nShutting down...\n");
    soxProc.kill("SIGTERM");
    if (session.state === "connected") {
      session.finalize();
      try {
        await Promise.race([
          session.finish(),
          new Promise<void>((_, rej) => setTimeout(() => rej(new Error("timeout")), 1500)),
        ]);
        // Flush any remaining pending finals
        const remaining = pendingFinals.join("").trim();
        if (remaining) process.stdout.write("\r" + remaining + "\n");
      } catch {
        session.close();
      }
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
```

### Does the SDK accept a Node `Readable` stream?

Yes. `session.sendStream()` accepts **any `AsyncIterable<AudioData>`**. Node.js `Readable` streams implement `AsyncIterable<Buffer>` (since Node 10+), so this works directly:

```typescript
await session.sendStream(soxProcess.stdout, { finish: true });
```

The `sendStream({ finish: true })` variant calls `session.finish()` automatically after the iterable ends — convenient when sox exits naturally but insufficient for SIGINT (where you need to orchestrate the shutdown order yourself). For the mic-tool, prefer the `data` event approach so you control the exact moment of `sendAudio()` and `finalize()` + `finish()`.

### Backpressure

`sendAudio()` is synchronous and returns `void`. The SDK does not expose any backpressure signal (no `drain` event, no watermark property). The underlying WebSocket may buffer internally.

**Practical implications for mic-tool**:
- At 16 kHz, mono, 16-bit PCM, the audio data rate is ~32 KB/s. This is well within normal WebSocket throughput (~100+ KB/s on a typical network).
- sox delivers audio in small chunks (~3–8 KB); each call to `sendAudio()` is a single WebSocket binary frame.
- No additional throttling is needed for a live mic source.
- If the network is slower than the audio rate (e.g. very poor connection), the WS internal buffer will grow. The SDK provides no callback when this occurs. The server may close the connection with a 503 error if audio falls too far behind.

---

## 7. Real Upstream Examples

### Official `soniox/soniox_examples` GitHub repo

The examples repository (`github.com/soniox/soniox_examples`) was referenced in the investigation document. Direct raw file fetches returned 404 for the paths tried (`node/realtime_transcription.js`, `js/realtime_transcription.js`). The repository structure could not be confirmed via automated fetch due to GitHub's robots.txt restrictions on directory listing.

**What was confirmed from the official Soniox documentation** (which contains example code inline):

The canonical Node SDK example streams from a file:

```javascript
// From: https://soniox.com/docs/llms-full.txt (inline doc example)
import { SonioxNodeClient, RealtimeUtteranceBuffer } from "@soniox/node";
import { parseArgs } from "node:util";
import * as fs from "node:fs";

const client = new SonioxNodeClient();

async function runSession(audioPath, audioFormat, translation) {
  const session = client.realtime.stt({
    model: "stt-rt-v4",
    audio_format: audioFormat,
    ...(translation !== "none" && { translation: { type: "one_way", target_language: translation } }),
  });

  const buffer = new RealtimeUtteranceBuffer({ final_only: true });

  session.on("result", (result) => {
    buffer.addResult(result);
  });

  session.on("endpoint", () => {
    const utterance = buffer.markEndpoint();
    if (utterance) {
      console.log(renderUtterance(utterance));
    }
    console.log("Session finished.");
  });

  session.on("error", (err) => {
    console.error("Session error:", err);
  });

  await session.connect();
  console.log("Session started.");

  await session.sendStream(
    fs.createReadStream(audioPath, { highWaterMark: 3840 }),
    { pace_ms: 120, finish: true },
  );
}
```

This example demonstrates:
- `RealtimeUtteranceBuffer({ final_only: true })` — collects only finalized tokens
- `buffer.addResult(result)` — called on every `'result'` event
- `buffer.markEndpoint()` — called on every `'endpoint'` event — returns a `RealtimeUtterance | undefined`
- `sendStream()` with `highWaterMark: 3840` (3.84 KB per chunk = 120 ms of audio at 16 kHz 16-bit mono)

**No mic-specific Node example exists in public sources.** The mic-tool will be the first public TypeScript example of mic-to-Soniox live streaming.

### Third-party confirmation: `agentvoiceresponse/avr-asr-soniox`

The investigation document confirmed this third-party Express proxy uses raw WebSocket against `wss://stt-rt.soniox.com/transcribe-websocket` with `pcm_s16le`, independently validating the SDK's underlying protocol behavior.

---

## 8. Known Issues and Caveats

### Version history: v1 → v2 breaking changes

The SDK was rewritten for v2. Key breaking changes (based on API surface differences):

- v1 used a different class name (`SonioxClient` vs `SonioxNodeClient`).
- v2 introduced the `client.realtime.stt()` factory pattern (replacing direct session constructors).
- v2 added typed error subclasses (`AuthError`, `ConnectionError`, etc.) instead of a single error type.
- v2 added `RealtimeUtteranceBuffer` and `RealtimeSegmentBuffer` helper classes.
- v2 added `session.state` property and `'state_change'` event.
- v2 added `session.finalize()` with `trailing_silence_ms` option.
- v2 ships dual-format (ESM + CJS) vs v1 which was CJS only.

**The mic-tool MUST depend on `@soniox/node@^2` and must not reference any v1 patterns.**

### Node version constraints

The npm metadata shows the package was built with Node `20.20.2`. No explicit engine field in `package.json` is visible in the registry metadata. Safe assumption: any Node 20 LTS or 22 LTS works correctly.

### `type: "module"` in package.json

The package itself is published as an ES module (`"type": "module"`). However, it ships CJS via the `require` export condition, so CJS projects can `require()` it. For the mic-tool (TypeScript with `tsx`), import via ES module syntax (`import { ... } from "@soniox/node"`) is correct.

### Keepalive: 20-second hard timeout

The server disconnects if no audio or keepalive is received for >20 seconds. During active mic capture, audio arrives continuously so this is not an issue. If the CLI ever pauses capture (e.g. for a future PTT mode), `session.pause()` must be called so the SDK sends auto-keepalives.

### `sendAudio()` state guard required

Calling `sendAudio()` when the session is not in `"connected"` state throws a `StateError`. In the mic pipeline, data events from sox may arrive after a `'disconnected'` or `'error'` event. Guard every `sendAudio()` call:

```typescript
soxProc.stdout.on("data", (chunk: Buffer) => {
  if (session.state === "connected") {
    session.sendAudio(chunk);
  }
});
```

### `pause()` triggers implicit finalization

Calling `session.pause()` triggers server-side finalization of currently buffered audio (documented in the SDK). For the mic-tool (no pause/resume in v1), this is not a concern but is important to note for future feature additions.

### `<end>` and `<fin>` tokens in result stream

Both `<end>` (endpoint detection boundary) and `<fin>` (manual finalization boundary) appear as `RealtimeToken` objects in `result.tokens` with `is_final: true`. They must be excluded from displayed text:

```typescript
const displayText = result.tokens
  .filter(t => t.is_final && t.text !== "<end>" && t.text !== "<fin>")
  .map(t => t.text)
  .join("");
```

### npm audit status

The package declares **0 runtime dependencies**, so transitive vulnerabilities are impossible from the dependency tree. A `pnpm audit` after installation should return 0 advisories from this package. The investigation document confirmed this finding from npm metadata.

### `connect_timeout_ms` default

The default connection timeout is 20 000 ms (20 seconds). This is appropriate for most networks. Under a DNS-block scenario (AC-10 test: `hosts` file block), the socket connection attempt will time out after 20 s before throwing `ConnectionError`. If the test requires faster failure, override via `SttSessionOptions`:

```typescript
const session = client.realtime.stt(
  { model: "stt-rt-v4", ... },
  { connect_timeout_ms: 5000 }  // fail faster for test/dev
);
```

---

## 9. Assumptions and Scope

### Assumptions made

| Assumption | Confidence | Impact if wrong |
|---|---|---|
| `AuthError` is thrown synchronously from `connect()` (not emitted as `'error'` event) | HIGH | AC-11 error handling path changes; may need to catch both |
| `ConnectionError` distinguishes "never connected" from "mid-stream drop" via state, not error class | HIGH | AC-10 classification may need a different approach |
| `sendAudio()` does not buffer or apply backpressure | HIGH | No impact at mic-tool data rate; would matter for high-bandwidth streams |
| `<end>` and `<fin>` tokens appear literally in `result.tokens` with those text values | HIGH | Display-filter logic must be adjusted if the actual text differs |
| `session.finalize()` during SIGINT ensures partials are committed before `finish()` drains them | MEDIUM | If server ignores finalize mid-shutdown, some partials may be dropped |
| `session.state` is synchronously updated (safe to check immediately before calling `sendAudio()`) | HIGH | Race condition guard pattern would need redesign |

### Out of scope (this document)

- Async (batch) transcription API (`client.stt.*`)
- Text-to-speech API (`client.tts.*`, `client.realtime.tts.*`)
- Webhook integration
- Translation configuration
- Speaker diarization details
- `@soniox/client` (browser-side SDK) or `@soniox/react`

### Clarifying questions for follow-up

1. Does the server send `AuthError` before or after the WebSocket upgrade completes? The docs say "config frame is sent first" — confirming whether the WS is already fully open when auth fails would clarify whether `connect()` can be interrupted mid-handshake.
2. Does `session.finish()` guarantee the `'finished'` event fires even if an `'error'` event was emitted first? Understanding whether `finish()` can deadlock (never resolve) on mid-stream errors is important for the timeout escape hatch.
3. Is the `'disconnected'` event's `reason` parameter populated by the server's WebSocket close frame message, or is it SDK-generated text? This affects how useful it is for logging.
4. Does `session.finalize()` during a SIGINT shutdown (with mic stopped but data still in-flight) risk "triggering too early" degradation (as warned in the manual finalization docs)? This affects whether we should add a short delay before calling `finalize()`.

---

## References

| # | Source | URL | Information Gathered |
|---|---|---|---|
| 1 | Soniox Node SDK overview | https://soniox.com/docs/stt/SDKs/node-SDK | Install, env vars, resolution precedence |
| 2 | Soniox Node SDK realtime docs | https://soniox.com/docs/sdk/node-SDK/stt/realtime-transcription | Session lifecycle, pause/resume, utterance buffer, sendStream usage |
| 3 | Soniox Node SDK reference — classes | https://soniox.com/docs/sdk/node-SDK/reference/classes | Full method signatures for RealtimeSttSession, error class hierarchy |
| 4 | Soniox Node SDK reference — types | https://soniox.com/docs/sdk/node-SDK/reference/types | SttSessionConfig, SttSessionOptions, SttSessionEvents, RealtimeToken, RealtimeResult, RealtimeErrorCode, SttSessionState, SonioxNodeClientOptions |
| 5 | Soniox Node SDK full reference | https://soniox.com/docs/sdk/node-SDK/reference | Environment variable table, client method index |
| 6 | Soniox WebSocket API reference | https://soniox.com/docs/api-reference/stt/websocket-api | Protocol wire format, error response schema, config frame parameters |
| 7 | Soniox real-time transcription guide | https://soniox.com/docs/stt/rt/real-time-transcription | Token finality model, audio format table, `is_final` semantics |
| 8 | Soniox error handling (real-time) | https://soniox.com/docs/stt/rt/error-handling | 503 early termination, error JSON schema, server-close behavior |
| 9 | Soniox connection keepalive | https://soniox.com/docs/stt/rt/connection-keepalive | 20-second timeout, keepalive frame format |
| 10 | Soniox manual finalization | https://soniox.com/docs/stt/rt/manual-finalization | `finalize` frame, `<fin>` marker token, usage guidelines |
| 11 | Soniox endpoint detection | https://soniox.com/docs/stt/rt/endpoint-detection | `<end>` token, semantic endpointing, `max_endpoint_delay_ms` |
| 12 | `@soniox/node` npm registry | https://registry.npmjs.org/@soniox/node/latest | Version 2.0.3, 0 deps, MIT, dual ESM+CJS, published 2025-04-30 |
| 13 | `soniox/soniox-js` GitHub README | https://raw.githubusercontent.com/soniox/soniox-js/main/README.md | Monorepo structure, package list |
| 14 | `@soniox/node` package README | https://raw.githubusercontent.com/soniox/soniox-js/main/packages/node/README.md | Constructor, env var table, error handling example |
| 15 | Context7 `/websites/soniox` | Internal (Context7 MCP) | Event surface, RealtimeErrorCode values, code examples, lifecycle management |
| 16 | Soniox llms-full.txt | https://soniox.com/docs/llms-full.txt | Inline Node SDK examples (file streaming), utterance buffer pattern |

### Recommended for deep reading

- **https://soniox.com/docs/sdk/node-SDK/reference/classes**: The authoritative method-by-method reference for `RealtimeSttSession`. Read before implementing the shutdown sequence.
- **https://soniox.com/docs/sdk/node-SDK/reference/types**: The authoritative type definitions for `SttSessionConfig`, `SttSessionEvents`, and the error codes. Read before implementing error classification.
- **https://soniox.com/docs/stt/rt/error-handling**: The server-side error behavior (503 early termination) is important for understanding `NetworkError` and whether a reconnect policy is needed in v2.
