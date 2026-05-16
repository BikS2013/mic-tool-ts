# mic-tool — Technical Design

**Document status**: Authoritative implementation specification for v1.
**Audience**: The engineer implementing Units A–E in Phase 5 of `plan-001-soniox-mic-cli.md`.
**Goal**: A coder picking up any one unit should be able to write it without re-reading the SDK research or investigation docs.

---

## 1. System Overview

### Elevator summary

`mic-tool` is a single-binary TypeScript CLI for macOS that captures live microphone audio with a spawned `sox` process, streams it as `pcm_s16le` 16 kHz mono PCM through the `@soniox/node` v2 WebSocket SDK to Soniox's `stt-rt-v4` real-time model, and renders the returned partial and final tokens to `stdout` in one of three modes (`overwrite`, `append`, `final-only`). The tool has zero hidden defaults: the Soniox API key is resolved deterministically through `--api-key` > local `.env` > shell env, and a missing key (or any other missing required configuration) raises a typed `MicToolError` subclass with a stable exit code. SIGINT triggers a bounded graceful shutdown that finalises pending partials, drains finals, and closes the WebSocket within 1.5 s.

### Data-flow diagram (audio path)

```
+-----------+   PCM bytes    +-------------+   Buffer    +-----------------+   sendAudio()   +-------------------+   tokens     +-------------+   bytes    +--------+
| macOS Mic | -------------> |  sox child  | ----------> | SoxMicSource    | --------------> | Transcriber       | -----------> | Renderer    | ---------> | stdout |
| (CoreAudio|   16 kHz mono  |  process    |  stdout pipe| (MicSource impl)|   (orchestrator | (@soniox/node v2  |  onTokens /  | (overwrite, |            |        |
|  default) |   16-bit LE    |  -d -t raw  | Readable    |                 |    bridges)     |  RealtimeSttSess) |  onEndpoint  |  append,    |            |        |
+-----------+                +-------------+             +-----------------+                 +-------------------+              |  final-only)|            +--------+
                                                                                                       |                        +-------------+
                                                                                                       | onError / onClose
                                                                                                       v
                                                                                                  +-----------+   bytes
                                                                                                  | Orchestr. | ----------> stderr (verbose logs, error messages)
                                                                                                  +-----------+
```

### Control-flow diagram (shutdown path)

```
   user presses Ctrl+C
            |
            v
   process.on('SIGINT')
            |
            v
   +-------------------+
   | Orchestrator      |
   | shutdown(code=0)  |---- (idempotent flag set) ---> any subsequent signal is a no-op
   +-------------------+
            |
            | 1. mic.stop()          : SIGTERM sox child, await 'exit' (fallback SIGKILL @ 500 ms)
            v
   +-------------------+
   | SoxMicSource.stop |
   +-------------------+
            |
            | 2. transcriber.stop()  : session.finalize() -> Promise.race(session.finish(), timeout(1500ms))
            v                          on timeout: session.close()
   +-------------------+
   | Transcriber.stop  |
   +-------------------+
            |
            | 3. renderer.dispose()  : flush trailing committed partials, clear-line on TTY
            v
   +-------------------+
   | Renderer.dispose  |
   +-------------------+
            |
            v
   process.exit(exitCode)
```

---

## 2. Component Architecture

The codebase is partitioned into six modules. The first five map 1:1 to Phase 5's Units A–E; `errors.ts` is the shared error vocabulary.

### 2.1 `src/config.ts` — Unit A (Config & CLI entry)

- **Purpose**: Parse `argv` via Commander; load `.env` via Node-native `process.loadEnvFile()`; resolve the API key through the precedence chain; produce a `ResolvedConfig`.
- **Public interface**: `resolveConfig(argv: string[]): Promise<ResolvedConfig>` and the `ResolvedConfig` type.
- **Internal design**:
  - Commander definitions live inside `resolveConfig` (no module-level side effects).
  - The Commander program intercepts `--help` and `--version` (both exit `0` via `process.exit`).
  - `.env` is loaded *only* when `opts.apiKey` was not supplied (small optimisation; not behavioural).
  - All validation happens after argv parsing and `.env` loading, before constructing `ResolvedConfig`.
  - `--verbose` log lines (e.g. "API key source: .env") write to `stderr`. The key value itself is **never** logged.
- **Error responsibilities**:
  - **Raises**: `MissingConfigurationError` (no API key found in any source).
  - **Propagates**: Commander's own exit on `--help`/`--version` (this is intentional; not an error).
  - **Does not raise**: any runtime/IO errors (the only IO is `process.loadEnvFile`, whose ENOENT is caught and treated as "no .env file present").

### 2.2 `src/mic/` — Unit B (Mic capture)

Files: `types.ts` (interface), `soxMicSource.ts` (macOS implementation), `index.ts` (platform-dispatching factory).

- **Purpose**: Provide a uniform `MicSource` interface for the orchestrator; the macOS implementation spawns `sox` and exposes its stdout as a `Readable<Buffer>`.
- **Public interface**: `MicSource` (see §3.2) and `createMicSource(opts): MicSource`.
- **Internal design**:
  - `SoxMicSource` uses `node:child_process.spawn` with `{ stdio: ["ignore", "pipe", "pipe"] }`.
  - The child's stdout *is* the `audio` `Readable<Buffer>` — there is no intermediate transform.
  - The child's stderr is buffered (last 256 bytes retained for error diagnostics). In verbose mode it is mirrored to `process.stderr` with a `[sox]` prefix.
  - A `'spawn'` listener resolves `start()`; an `'error'` listener catches ENOENT and rejects `start()` with `MicNotAvailableError`.
  - A `'exit'` listener with non-zero code classifies the error from the stderr tail.
- **Error responsibilities**:
  - **Raises**: `MicNotAvailableError` (sox not on PATH), `MicPermissionDeniedError` (CoreAudio rejected access), generic `MicToolError` (any other non-zero sox exit), `UnsupportedPlatformError` (factory called on non-darwin).
  - **Propagates**: nothing.

### 2.3 `src/soniox/client.ts` — Unit C (Soniox client wrapper)

- **Purpose**: Adapt the `@soniox/node` `SonioxNodeClient` / `RealtimeSttSession` surface to the CLI's narrower `Transcriber` interface; map every Soniox error class to a typed `MicToolError`; encapsulate the bounded-timeout shutdown.
- **Public interface**: `Transcriber` (see §3.3) and `createTranscriber(cfg): Transcriber`.
- **Internal design**:
  - The wrapper owns the SDK objects (`client`, `session`); callers never see them.
  - It accumulates non-final tokens into a `partialBuffer` and emits via the `onPartial` callback on every token batch.
  - On the first `is_final: true` token, the buffered text is promoted to `onFinal` and the buffer is cleared.
  - The marker tokens `<end>` and `<fin>` are dropped *before* they ever reach the partial buffer.
  - All `session.sendAudio(...)` calls are guarded by `session.state === "connected"`. Audio that arrives outside that window is **dropped silently** (in v1; logged in verbose mode).
- **Error responsibilities**:
  - **Raises** (from `start()`): `SonioxAuthError`, `SonioxNetworkError` (pre-connect), `SonioxProtocolError`.
  - **Surfaces via `onError` callback** (mid-stream): `SonioxNetworkError`, `SonioxProtocolError`.
  - **Propagates**: nothing — every Soniox SDK error class is mapped before crossing the wrapper's boundary.

### 2.4 `src/render/renderer.ts` — Unit D (Renderer)

- **Purpose**: Translate the unit-internal `{ text, isFinal }[]` token shape into stdout bytes according to the chosen output mode; manage TTY-vs-pipe behaviour; filter marker tokens (defence-in-depth; Unit C already filters).
- **Public interface**: `Renderer` (see §3.4) and `createRenderer(mode, stdout): Renderer`.
- **Internal design**:
  - The renderer is mode-dispatched at construction (`overwrite | append | final-only`).
  - `overwrite` mode is implicitly downgraded to `append` when `stdout.isTTY === false` (see §7).
  - All three modes share a marker-filter helper and ignore empty text.
- **Error responsibilities**:
  - **Raises**: nothing. Renderer is best-effort; if `stdout.write` fails the error is allowed to surface to the orchestrator's top-level catch.

### 2.5 `src/main.ts` + `src/index.ts` — Unit E (Orchestrator)

- **Purpose**: Compose Units A–D; install signal handlers; map errors to exit codes; own the top-level try/catch.
- **Public interface**: `main(argv: string[]): Promise<number>` (returns the exit code; never calls `process.exit` itself except in the `index.ts` shim).
- **Internal design**:
  - Linear setup: `resolveConfig` → `createRenderer` → `createTranscriber` → `transcriber.start` → `createMicSource` → `mic.start` → wire `mic.audio` `'data'` events to `transcriber.pushAudio`.
  - Idempotent `shutdown(exitCode)` driven by a `shuttingDown: boolean` flag.
  - Each Unit-C event (`onPartial`, `onFinal`, `onEndpoint`, `onError`, `onClose`) is wired to the renderer (for transcript callbacks) or to `shutdown` (for terminal events).
- **Error responsibilities**:
  - **Raises**: nothing (top-level catch absorbs everything and maps to exit codes).
  - **Maps**: each `MicToolError` subclass to its `exitCode`; any unknown `Error` to exit code `1`.

### 2.6 `src/errors.ts` — Shared error taxonomy

- **Purpose**: Stable, typed error hierarchy with an exit-code map. Imported by every other module.
- **Public interface**: see §3.5.
- **Internal design**: every subclass sets `this.name = new.target.name` (so stack traces show the concrete class name) and accepts a single `message: string` constructor argument; the exit code is hard-coded per subclass.
- **Error responsibilities**: provides classes only; raises nothing itself.

---

## 3. Interface Contracts (authoritative TypeScript)

These declarations are frozen. Units A–D are coded in parallel against these signatures.

### 3.1 `ResolvedConfig` (from `src/config.ts`)

```ts
export type OutputMode = "overwrite" | "append" | "final-only";

export interface ResolvedConfig {
  /** Soniox API key. Always non-empty (validation enforced before construction). */
  readonly apiKey: string;

  /** ISO-639-1 code (e.g. "en", "es") OR the literal "auto" for language identification. */
  readonly language: string;

  /** Stdout rendering mode. */
  readonly outputMode: OutputMode;

  /** Diagnostic logging to stderr. */
  readonly verbose: boolean;
}

/**
 * Resolves CLI args + .env + shell env into a frozen ResolvedConfig.
 *
 * @throws {MissingConfigurationError} when no API key is found via any source.
 * @throws {MicToolError} on invalid --language or --output-mode value (validation).
 *
 * Side-effects: may call `process.loadEnvFile()` once (mutates `process.env`).
 * Exits the process directly (via Commander) for --help and --version.
 */
export function resolveConfig(argv: string[]): Promise<ResolvedConfig>;
```

### 3.2 `MicSource` (from `src/mic/types.ts`)

```ts
import type { Readable } from "node:stream";

export interface MicSourceOptions {
  readonly verbose: boolean;
}

export interface MicSource {
  /**
   * Start mic capture. Resolves once the subprocess has spawned and `audio` is readable.
   *
   * @throws {MicNotAvailableError}      sox binary not on PATH (ENOENT on spawn).
   * @throws {MicPermissionDeniedError}  CoreAudio rejected mic access.
   * @throws {MicToolError}              any other non-zero sox exit during startup.
   */
  start(): Promise<void>;

  /**
   * Readable stream of pcm_s16le mono 16 kHz audio bytes.
   * Only valid AFTER `start()` resolves; reading earlier yields no data.
   * The stream ends (`'end'` event) when `stop()` completes.
   */
  readonly audio: Readable;

  /**
   * Stop mic capture. Idempotent. Resolves once the subprocess has exited.
   * Sends SIGTERM, then SIGKILL after a 500 ms grace period.
   */
  stop(): Promise<void>;
}

/**
 * Factory dispatching by `process.platform`.
 * @throws {UnsupportedPlatformError} on any platform other than 'darwin'.
 */
export function createMicSource(opts: MicSourceOptions): MicSource;
```

### 3.3 `Transcriber` (from `src/soniox/client.ts`)

```ts
export interface TranscriberConfig {
  readonly apiKey: string;
  readonly language: string;   // "en" | "auto" | other ISO-639-1
  readonly verbose: boolean;
}

export interface TranscriberCallbacks {
  /** Fires on every result that contains at least one non-final token (after marker filter). */
  onPartial: (text: string) => void;

  /** Fires when the current utterance is committed (a final token arrived, or endpoint fired). */
  onFinal: (text: string) => void;

  /** Fires on the server-side semantic endpoint marker ('<end>' token). */
  onEndpoint: () => void;

  /** Mid-stream error, already mapped to a MicToolError subclass. */
  onError: (err: Error) => void;

  /** WebSocket closed (clean or unclean). */
  onClose: () => void;
}

export interface Transcriber {
  /**
   * Open the WebSocket and start streaming.
   *
   * @throws {SonioxAuthError}     SDK AuthError.
   * @throws {SonioxNetworkError}  SDK ConnectionError / NetworkError before connect.
   * @throws {SonioxProtocolError} SDK BadRequestError / QuotaError / unmapped server error.
   */
  start(callbacks: TranscriberCallbacks): Promise<void>;

  /**
   * Push a PCM chunk. No-op if session state != "connected".
   * Never throws (StateError is converted to a silent drop).
   */
  pushAudio(chunk: Buffer): void;

  /**
   * Graceful shutdown: finalize() -> finish() -> close().
   * Bounded by a 1.5 s timeout. Idempotent.
   */
  stop(): Promise<void>;
}

export function createTranscriber(cfg: TranscriberConfig): Transcriber;
```

### 3.4 `Renderer` (from `src/render/renderer.ts`)

```ts
import type { OutputMode } from "../config.js";

export interface Renderer {
  /** Render a partial (interim) transcript. May be called many times before final(). */
  partial(text: string): void;

  /** Commit a final utterance line. After this, the partial buffer is reset. */
  final(text: string): void;

  /** Called at orchestrator shutdown. Flushes any committed-but-unprinted state and emits a clear-line on TTY. */
  dispose(): void;
}

/** Build a renderer. May silently downgrade `overwrite` -> `append` when stdout is not a TTY. */
export function createRenderer(mode: OutputMode, stdout: NodeJS.WriteStream): Renderer;
```

### 3.5 Error hierarchy (from `src/errors.ts`)

```ts
/** Base class for all CLI-typed errors. Carries the process exit code. */
export class MicToolError extends Error {
  public readonly exitCode: number;
  constructor(message: string, exitCode: number) {
    super(message);
    this.name = new.target.name;
    this.exitCode = exitCode;
  }
}

/** No API key resolved from any source, or invalid value supplied for --language / --output-mode. */
export class MissingConfigurationError extends MicToolError {
  constructor(message: string) { super(message, 2); }
}

/** sox binary not found on PATH. */
export class MicNotAvailableError extends MicToolError {
  constructor(message: string) { super(message, 3); }
}

/** macOS denied mic access to the parent terminal. */
export class MicPermissionDeniedError extends MicToolError {
  constructor(message: string) { super(message, 3); }
}

/** Soniox rejected the API key (HTTP 401 / AuthError). */
export class SonioxAuthError extends MicToolError {
  constructor(message: string) { super(message, 4); }
}

/** Soniox unreachable (DNS, refused, timeout, mid-stream drop). */
export class SonioxNetworkError extends MicToolError {
  constructor(message: string) { super(message, 5); }
}

/** Soniox returned a protocol-level error (bad config, quota, unknown error code). */
export class SonioxProtocolError extends MicToolError {
  constructor(message: string) { super(message, 6); }
}

/** Mic capture invoked on a non-darwin platform in v1. */
export class UnsupportedPlatformError extends MicToolError {
  constructor(message: string) { super(message, 3); }
}

/** Stable map for documentation / docs/configuration-guide.md. Source of truth: per-class exitCode. */
export const ExitCode = {
  SUCCESS: 0,
  UNKNOWN: 1,
  MISSING_CONFIG: 2,
  MIC_UNAVAILABLE_OR_DENIED: 3,
  SONIOX_AUTH: 4,
  SONIOX_NETWORK: 5,
  SONIOX_PROTOCOL: 6,
} as const;
```

Note on exit codes: the plan file (`plan-001`) used a slightly different mapping (mic-unavailable=3, mic-permission=4, auth=5, ...). This design consolidates "mic unavailable" and "mic permission denied" under exit code `3` because — from a CLI user's perspective — both are the same class of failure (mic is not delivering audio) and the message text is what differentiates them. The downstream effect is: the orchestrator maps both `MicNotAvailableError` and `MicPermissionDeniedError` to exit `3`. The plan's higher numeric codes (5/6/7) compress to `4/5/6` here. The plan must be reconciled to this mapping during Phase 7 (build & audit gate).

---

## 4. Configuration Design (Unit A)

### 4.1 Resolution chain

The chain is implemented in this exact order; the **first source that yields a non-empty string wins**:

1. `--api-key <value>` CLI flag.
2. `.env` file at `path.resolve(process.cwd(), ".env")` via `process.loadEnvFile(path)`. Loaded only when step 1 yielded nothing.
3. `process.env.SONIOX_API_KEY` (the shell environment).

**Why `.env` wins over shell env**: this is the explicit FR-5 contract. The mechanism is straightforward — `process.loadEnvFile()` **overwrites** existing `process.env` entries by default. So once we call it (after parsing the flag and not finding one), any `.env`-defined `SONIOX_API_KEY` clobbers the shell-supplied value, and the subsequent `process.env.SONIOX_API_KEY` read returns the `.env` value.

### 4.2 Safe `.env` loading

```ts
function loadDotenvIfPresent(envPath: string): void {
  try {
    process.loadEnvFile(envPath);
  } catch (err) {
    // Node throws when the file does not exist. That's allowed — .env is optional.
    // We re-throw any other error (e.g. parse error) so the user sees it.
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw err;
  }
}
```

The function is **always called** before reading `process.env.SONIOX_API_KEY` (except when `--api-key` already supplied the value, in which case we skip `.env` loading entirely to avoid surprising env-mutation side effects).

### 4.3 Validation rules (per field)

| Field | Rule | Error on violation |
|---|---|---|
| `apiKey` | `typeof v === "string" && v.trim().length > 0` | `MissingConfigurationError("SONIOX_API_KEY is not set. Provide it via --api-key <key>, a .env file in the working directory, or the SONIOX_API_KEY environment variable.")` |
| `language` | `v === "auto"` OR `/^[a-z]{2,3}(-[A-Z]{2})?$/.test(v)` | `MissingConfigurationError("--language must be 'auto' or an ISO-639-1/2 code (e.g. 'en', 'es', 'pt-BR'). Got: '<v>'.")` |
| `outputMode` | One of `"overwrite" | "append" | "final-only"` | Commander rejects with its own choices error before we ever see it. |
| `verbose` | Boolean (Commander coerces) | n/a |

Defaults applied by Commander (these are **documented defaults**, not silent fallbacks per NFR-5): `--language en`, `--output-mode overwrite`, `--verbose false`.

### 4.4 Verbose-mode logging at start

When `cfg.verbose === true`, the orchestrator (NOT `resolveConfig` itself) writes the following to stderr **after** `resolveConfig` returns:

```
[mic-tool] config: apiKeySource=<.env|env|flag>, language=<v>, outputMode=<v>
[mic-tool] platform=darwin, node=<version>
```

`resolveConfig` does not write to stderr itself; it returns the `apiKeySource` as an additional out-of-band value if needed. (Simplest implementation: pass a `log: (line: string) => void` callback into `resolveConfig`, or return a `{ config, sources }` tuple. The plan's signature `Promise<ResolvedConfig>` is preserved by having `resolveConfig` write to stderr directly *only when* it has already seen `--verbose` in argv. This is acceptable because `--verbose` is parsed before any sensitive logging.)

**The key value is never logged. Only its source name (`flag`, `.env`, `env`) is logged.**

---

## 5. Mic-Capture Design (Unit B)

### 5.1 Spawn command

```ts
const SOX_ARGS = [
  "-q",                  // suppress sox's interactive progress bar on stderr
  "-d",                  // default input device (CoreAudio current default mic)
  "-t", "raw",           // raw output (no container header)
  "-r", "16000",         // sample rate 16 kHz
  "-c", "1",             // mono
  "-b", "16",            // 16-bit samples
  "-e", "signed-integer",
  "-L",                  // little-endian
  "-",                   // write to stdout
] as const;

const child = spawn("sox", SOX_ARGS, { stdio: ["ignore", "pipe", "pipe"] });
```

Output produced on `child.stdout`: an unending stream of raw PCM bytes at exactly 32 000 bytes/s (16 000 samples × 2 bytes).

### 5.2 Exposing `audio: Readable<Buffer>`

`child.stdout` is already a `Readable<Buffer>`. `SoxMicSource` exposes it directly as the `audio` property — no wrapping or re-piping is needed. The orchestrator attaches a `'data'` event listener on `mic.audio` and forwards every chunk to `transcriber.pushAudio(chunk)`.

### 5.3 Startup state machine

```
state: 'idle' --start()--> 'starting' --child 'spawn' event--> 'running' --stop()--> 'stopping' --child 'exit'--> 'stopped'
                                  \---child 'error' event--> reject start() with mapped error
```

Implementation outline:

```ts
async start(): Promise<void> {
  if (this.state !== "idle") throw new MicToolError("SoxMicSource.start() already called", 1);
  this.state = "starting";

  this.child = spawn("sox", SOX_ARGS, { stdio: ["ignore", "pipe", "pipe"] });

  // Buffer last 256 bytes of stderr for diagnostic classification.
  this.child.stderr.on("data", (chunk: Buffer) => {
    this.stderrTail = (this.stderrTail + chunk.toString("utf8")).slice(-256);
    if (this.verbose) process.stderr.write(chunk);
  });

  return new Promise<void>((resolve, reject) => {
    const onSpawn = () => {
      this.state = "running";
      this.child!.off("error", onError);
      resolve();
    };
    const onError = (err: NodeJS.ErrnoException) => {
      this.state = "stopped";
      this.child!.off("spawn", onSpawn);
      if (err.code === "ENOENT") {
        reject(new MicNotAvailableError("sox is not installed. Run: brew install sox"));
      } else {
        reject(new MicToolError(`Failed to spawn sox: ${err.message}`, 3));
      }
    };
    this.child!.once("spawn", onSpawn);
    this.child!.once("error", onError);
  });

  // After resolution, install the long-lived 'exit' listener that
  // distinguishes permission-denied from other failures (see §5.4).
}
```

### 5.4 Error mapping on non-zero exit

The `child` may spawn fine but then exit non-zero a moment later (typical for macOS mic-permission denial: sox spawns, tries to open CoreAudio, fails, prints `coreaudio: ...` to stderr, exits with code 2).

```ts
this.child.once("exit", (code, signal) => {
  if (this.state === "stopping") return; // expected exit during shutdown
  if (code === 0 || code === null) return;
  if (/permission|not authorized|coreaudio|input device/i.test(this.stderrTail)) {
    this.emit("error", new MicPermissionDeniedError(
      "Microphone access denied. Grant access in System Settings > Privacy & Security > Microphone, then re-run mic-tool."
    ));
  } else {
    this.emit("error", new MicToolError(
      `sox exited with code ${code}: ${this.stderrTail.trim()}`,
      3
    ));
  }
});
```

The `emit('error', ...)` propagates to the orchestrator, which invokes `shutdown(err.exitCode)`.

### 5.5 Graceful stop

```ts
async stop(): Promise<void> {
  if (this.state === "stopped" || this.state === "idle") return;
  this.state = "stopping";

  return new Promise<void>((resolve) => {
    const child = this.child!;
    const killTimer = setTimeout(() => child.kill("SIGKILL"), 500);
    child.once("exit", () => {
      clearTimeout(killTimer);
      this.state = "stopped";
      resolve();
    });
    child.kill("SIGTERM");
  });
}
```

Idempotency: a second call to `stop()` short-circuits because `state !== 'running'`.

### 5.6 Factory & platform dispatch

```ts
// src/mic/index.ts
export function createMicSource(opts: MicSourceOptions): MicSource {
  if (process.platform === "darwin") return new SoxMicSource(opts);
  throw new UnsupportedPlatformError(
    `Mic capture for platform '${process.platform}' is not implemented in v1. Only macOS (darwin) is supported.`
  );
}
```

`SoxMicSource` extends `EventEmitter` (so it can emit `'error'`) and implements `MicSource`.

---

## 6. Soniox Client Wrapper Design (Unit C)

### 6.1 Session configuration

```ts
const languageOpts = cfg.language === "auto"
  ? { enable_language_identification: true as const }
  : { language_hints: [cfg.language] };

const session = client.realtime.stt(
  {
    model: "stt-rt-v4",
    audio_format: "pcm_s16le",
    sample_rate: 16000,
    num_channels: 1,
    enable_endpoint_detection: true,
    max_endpoint_delay_ms: 2000,
    ...languageOpts,
  },
  {
    connect_timeout_ms: 5000,  // fail fast (default 20 000 is too long for AC-10)
  }
);
```

### 6.2 Event wiring (must happen BEFORE `connect()`)

```ts
session.on("result",       (result) => this.onResult(result));
session.on("endpoint",     ()       => this.callbacks.onEndpoint());
session.on("disconnected", ()       => this.callbacks.onClose());

// One-shot pre-connect 'error' listener — safety net for the case where
// the SDK delivers a connect-time error via the event channel instead of
// the thrown-from-connect() channel. Removed on successful connect.
const preConnectErrorListener = (err: unknown) => {
  this.preConnectError = mapSonioxError(err);
};
session.once("error", preConnectErrorListener);
```

### 6.3 `start()` flow

```ts
async start(callbacks: TranscriberCallbacks): Promise<void> {
  this.callbacks = callbacks;
  this.client  = new SonioxNodeClient({ api_key: this.cfg.apiKey });
  this.session = this.client.realtime.stt(sessionConfig, sessionOptions);

  this.wireEvents();  // see §6.2 (including pre-connect 'error' listener)

  try {
    await this.session.connect();
  } catch (err) {
    throw mapSonioxError(err);  // AuthError / ConnectionError / NetworkError -> typed CLI errors
  }

  // If the pre-connect 'error' listener fired during connect():
  if (this.preConnectError) throw this.preConnectError;
  this.session.off("error", preConnectErrorListener);

  // Install the long-lived mid-stream 'error' listener.
  this.session.on("error", (err) => {
    this.callbacks.onError(mapSonioxError(err));
  });
}
```

### 6.4 `pushAudio()` flow

```ts
pushAudio(chunk: Buffer): void {
  if (!this.session || this.session.state !== "connected") {
    if (this.cfg.verbose) {
      process.stderr.write(`[mic-tool] dropped ${chunk.length} audio bytes (session not connected)\n`);
    }
    return;
  }
  try {
    this.session.sendAudio(chunk);
  } catch {
    // StateError from race between state check and send — drop silently.
  }
}
```

### 6.5 Token handling: partial / final / marker filter

```ts
private partialBuffer = "";

private onResult(result: RealtimeResult): void {
  let producedFinal = false;
  let finalText = "";

  for (const tok of result.tokens) {
    if (tok.text === "<end>" || tok.text === "<fin>") continue;  // marker filter
    if (tok.is_final) {
      finalText += tok.text;
      producedFinal = true;
    } else {
      this.partialBuffer += tok.text;
    }
  }

  if (this.partialBuffer.length > 0) {
    this.callbacks.onPartial(this.partialBuffer);
  }

  if (producedFinal) {
    // Promote: emit the committed line, then reset.
    const committed = (finalText + this.partialBuffer).trim();
    if (committed.length > 0) this.callbacks.onFinal(committed);
    this.partialBuffer = "";
  }
}
```

This algorithm matches the SDK research §4 finality model: partials are emitted on every result; finals "promote and clear". The renderer's three modes consume these two callbacks differently (§7).

### 6.6 Error mapper

```ts
function mapSonioxError(err: unknown): MicToolError {
  if (err instanceof AuthError) {
    return new SonioxAuthError("Soniox rejected the API key. Verify SONIOX_API_KEY is correct.");
  }
  if (err instanceof ConnectionError || err instanceof NetworkError) {
    return new SonioxNetworkError(`Could not reach Soniox: ${(err as Error).message}`);
  }
  if (err instanceof BadRequestError || err instanceof QuotaError || err instanceof StateError) {
    return new SonioxProtocolError(`Soniox protocol error: ${(err as Error).message}`);
  }
  // Catch-all (RealtimeError, SonioxError, plain Error, unknown)
  const msg = err instanceof Error ? err.message : String(err);
  return new SonioxProtocolError(`Unexpected Soniox error: ${msg}`);
}
```

### 6.7 Shutdown sequence

```ts
async stop(): Promise<void> {
  if (this.stopping) return;
  this.stopping = true;

  if (!this.session || this.session.state !== "connected") {
    this.session?.close();
    return;
  }

  this.session.finalize();  // synchronous fire-and-forget

  try {
    await Promise.race([
      this.session.finish(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("shutdown timeout")), 1500)),
    ]);
  } catch {
    // Timeout or finish() rejection — force-close.
    try { this.session.close(); } catch { /* ignore */ }
  }
}
```

The 1.5 s timeout satisfies AC-8 ("exit 0 within 1 second" → the design budgets 1.5 s for the SDK and reserves the remaining ~500 ms for `mic.stop()` + `renderer.dispose()` + process exit). On a healthy network `session.finish()` typically resolves in 100–300 ms.

---

## 7. Renderer Design (Unit D)

### 7.1 Mode definitions

#### `overwrite` (the default)

State: `prevLineLen: number` (length of last text written to the current line).

```ts
partial(text: string): void {
  const padding = Math.max(0, this.prevLineLen - text.length);
  this.stdout.write("\r" + text + " ".repeat(padding));
  this.prevLineLen = text.length;
}

final(text: string): void {
  const padding = Math.max(0, this.prevLineLen - text.length);
  this.stdout.write("\r" + text + " ".repeat(padding) + "\n");
  this.prevLineLen = 0;
}

dispose(): void {
  // Clear the current overwrite line (if any) before exit so the shell prompt is clean.
  if (this.prevLineLen > 0) {
    this.stdout.write("\r" + " ".repeat(this.prevLineLen) + "\r");
    this.prevLineLen = 0;
  }
}
```

#### `append`

```ts
partial(text: string): void { this.stdout.write(text + "\n"); }
final(text: string):   void { this.stdout.write(text + "\n"); }
dispose(): void {}
```

Every `onPartial` and every `onFinal` from Unit C produces exactly one line. Maximally pipe-friendly.

#### `final-only`

```ts
partial(text: string): void { /* no-op */ }
final(text: string):   void { this.stdout.write(text + "\n"); }
dispose(): void {}
```

Cleanest pipe output; one line per utterance.

### 7.2 TTY-vs-pipe behaviour

```ts
export function createRenderer(mode: OutputMode, stdout: NodeJS.WriteStream): Renderer {
  const isTTY = Boolean((stdout as { isTTY?: boolean }).isTTY);
  // Explicit user choice still downgrades: we never write '\r' to a non-TTY.
  const effectiveMode: OutputMode = (mode === "overwrite" && !isTTY) ? "append" : mode;
  switch (effectiveMode) {
    case "overwrite":  return new OverwriteRenderer(stdout);
    case "append":     return new AppendRenderer(stdout);
    case "final-only": return new FinalOnlyRenderer(stdout);
  }
}
```

This satisfies AC-12: piping `mic-tool > file.txt` with the default mode produces a file containing only transcript text — no `\r` characters, no ANSI artifacts. Even if the user explicitly passes `--output-mode overwrite` while piping, the downgrade still applies (no `\r` ever written to a non-TTY).

If verbose mode is enabled and the downgrade triggers, the orchestrator logs once to stderr:

```
[mic-tool] stdout is not a TTY: --output-mode overwrite downgraded to 'append'.
```

### 7.3 Marker filter (defence-in-depth)

Unit C already strips `<end>` and `<fin>` before they reach the renderer. The renderer applies the same filter on the text it receives — any text equal to `<end>` or `<fin>` is silently dropped — so a future Unit-C regression cannot leak markers to stdout.

---

## 8. Orchestrator Design (Unit E)

### 8.1 `main(argv)` happy path

```ts
export async function main(argv: string[]): Promise<number> {
  let mic: MicSource | undefined;
  let transcriber: Transcriber | undefined;
  let renderer: Renderer | undefined;
  let shuttingDown = false;
  let exitCode = 0;

  const shutdown = async (code: number): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    exitCode = code;
    if (cfg?.verbose) process.stderr.write("[mic-tool] shutting down...\n");
    try { await mic?.stop(); } catch { /* swallow */ }
    try { await transcriber?.stop(); } catch { /* swallow */ }
    try { renderer?.dispose(); } catch { /* swallow */ }
  };

  let cfg: ResolvedConfig | undefined;
  try {
    cfg = await resolveConfig(argv);
    renderer    = createRenderer(cfg.outputMode, process.stdout);
    transcriber = createTranscriber({ apiKey: cfg.apiKey, language: cfg.language, verbose: cfg.verbose });
    mic         = createMicSource({ verbose: cfg.verbose });

    process.once("SIGINT",  () => void shutdown(0));
    process.once("SIGTERM", () => void shutdown(0));

    await transcriber.start({
      onPartial:  (t)   => renderer!.partial(t),
      onFinal:    (t)   => renderer!.final(t),
      onEndpoint: ()    => { /* no-op v1; partial->final promotion already covers it */ },
      onError:    (err) => {
        process.stderr.write(`${err.message}\n`);
        void shutdown((err as MicToolError).exitCode ?? 1);
      },
      onClose:    ()    => { if (!shuttingDown) void shutdown(ExitCode.SONIOX_NETWORK); },
    });

    await mic.start();
    mic.audio.on("data", (chunk: Buffer) => transcriber!.pushAudio(chunk));
    (mic as EventEmitter).on("error", (err: Error) => {
      process.stderr.write(`${err.message}\n`);
      void shutdown((err as MicToolError).exitCode ?? 1);
    });

    if (cfg.verbose) process.stderr.write("[mic-tool] connected. Listening on default mic. Press Ctrl+C to stop.\n");

    // Wait for a shutdown trigger.
    await new Promise<void>((resolve) => {
      const t = setInterval(() => { if (shuttingDown) { clearInterval(t); resolve(); } }, 50);
    });

    return exitCode;
  } catch (err) {
    return handleTopLevelError(err);
  }
}

function handleTopLevelError(err: unknown): number {
  if (err instanceof MicToolError) {
    process.stderr.write(`${err.name}: ${err.message}\n`);
    return err.exitCode;
  }
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`UnknownError: ${msg}\n`);
  return ExitCode.UNKNOWN;
}
```

### 8.2 `src/index.ts` (bin entry)

```ts
#!/usr/bin/env node
import { main } from "./main.js";
main(process.argv).then((code) => process.exit(code)).catch((err) => {
  process.stderr.write(`FatalError: ${(err as Error).message ?? err}\n`);
  process.exit(1);
});
```

### 8.3 Backpressure policy

The mic's `Readable` is the producer; the orchestrator pipes its `'data'` events into `transcriber.pushAudio()`. At 16 kHz mono PCM the data rate is ~32 KB/s — well below the throughput of a healthy WebSocket. If the SDK signals it is not ready (`session.state !== "connected"`), audio is dropped silently in v1 (logged in verbose mode only). No buffer, no retry. This is acceptable because non-`connected` state during normal operation only occurs during the very brief window of shutdown.

### 8.4 Signal handling

`process.once("SIGINT", ...)` and `process.once("SIGTERM", ...)` are installed exactly once. The `shutdown()` function is itself idempotent (guarded by `shuttingDown`), so a second SIGINT does nothing.

### 8.5 Exit-code map (final, authoritative)

| Code | Constant | Cause |
|---|---|---|
| 0 | `SUCCESS` | Clean exit (SIGINT or natural end of stream). |
| 1 | `UNKNOWN` | Any non-`MicToolError` exception. |
| 2 | `MISSING_CONFIG` | `MissingConfigurationError`. |
| 3 | `MIC_UNAVAILABLE_OR_DENIED` | `MicNotAvailableError`, `MicPermissionDeniedError`, `UnsupportedPlatformError`, or any other startup error from `SoxMicSource`. |
| 4 | `SONIOX_AUTH` | `SonioxAuthError`. |
| 5 | `SONIOX_NETWORK` | `SonioxNetworkError` (pre-connect or mid-stream). |
| 6 | `SONIOX_PROTOCOL` | `SonioxProtocolError`. |

---

## 9. Concurrency & Lifecycle Diagram

```
time --->

t=0      orchestrator: main() starts
t=0+     resolveConfig --> ResolvedConfig
t=0+     createRenderer --> Renderer (mode chosen, TTY downgrade applied)
t=0+     createTranscriber --> Transcriber (idle, no socket yet)
t=0+     createMicSource --> SoxMicSource (idle, no child yet)
t=0+     install SIGINT / SIGTERM handlers

t=1      transcriber.start():
            new SonioxNodeClient(apiKey)
            session = client.realtime.stt(cfg, {connect_timeout_ms:5000})
            wire 'result' 'endpoint' 'disconnected' 'error' (pre-connect one-shot)
            await session.connect()      <----- WS handshake + config frame -----> Soniox
t=1.1                                  <--- 'connected' ----
t=1.1    install long-lived 'error' listener; pre-connect listener removed.

t=2      mic.start():
            spawn('sox', [...])
            await child 'spawn' event
            state = 'running'

t=2+     mic.audio 'data' -----> transcriber.pushAudio() ----> session.sendAudio() ----> Soniox
                                                                                          |
                                                                                          | (real-time recognition)
                                                                                          v
t=2.4    Soniox sends 'result' frame { tokens: [partial1] }
            onResult --> partialBuffer = 'hello'
            callbacks.onPartial('hello') --> renderer.partial('hello') --> stdout: "\rhello"

t=2.7    Soniox sends 'result' frame { tokens: [partial1, partial2 final] }
            onResult --> final committed: 'hello world'
            callbacks.onFinal('hello world') --> renderer.final(...) --> stdout: "\rhello world\n"
            partialBuffer cleared

t=2.8    Soniox sends 'endpoint' event
            callbacks.onEndpoint()  -- no-op in v1 (final-promotion already handled commit)

  (loop: partials -> finals -> endpoints repeat indefinitely)

t=T      user presses Ctrl+C
            process emits SIGINT
            orchestrator.shutdown(0):  shuttingDown = true

t=T+0.0  mic.stop():
            state -> 'stopping'
            child.kill('SIGTERM')
            await child 'exit'  (typically < 100 ms)
            state -> 'stopped'
            mic.audio 'end' (no more 'data' events)

t=T+0.1  transcriber.stop():
            session.finalize()                  ---> Soniox (force-finalize partials)
                                            <--- 'result' frames with is_final:true tokens, then 'finalized'
                                            <--- per-token onResult --> onFinal --> renderer.final(...)
            Promise.race(session.finish(), timeout(1500ms))
            session.finish()                    ---> Soniox (EOS empty frame)
                                            <--- 'result' frame with finished:true
                                            <--- 'finished' event
                                            <--- WS close
                                            <--- 'disconnected' event --> onClose (suppressed: shuttingDown=true)

t=T+0.4  renderer.dispose():
            (overwrite mode): write "\r<spaces>\r" to clear current line
            (other modes): no-op

t=T+0.4  main() returns exitCode=0
t=T+0.4  index.ts: process.exit(0)

  (entire shutdown completes well within the AC-8 budget of 1.5 s)
```

---

## 10. Test Surface

### 10.1 Unit tests (each unit isolated; others mocked)

| Unit | Seams to exercise |
|---|---|
| `config.ts` | argv parsing: every flag combination; precedence (`--api-key` > `.env` > shell env); missing-key error; invalid `--language`; `process.loadEnvFile` ENOENT handled (use `mock-fs` or a tmpdir); precedence test sets `process.env`, writes a temp `.env`, runs `resolveConfig`. |
| `soxMicSource.ts` | Mock `child_process.spawn` (return a stub `ChildProcess` with controllable streams + events). Cases: ENOENT on spawn → `MicNotAvailableError`; non-zero exit with `coreaudio` in stderr → `MicPermissionDeniedError`; clean exit during stop → resolves; SIGTERM-then-SIGKILL fallback. |
| `client.ts` | Mock `@soniox/node` module via `vi.mock`. Cases: `connect()` throws `AuthError` → wrapper throws `SonioxAuthError`; pre-connect `'error'` event → mapped & thrown; mid-stream `'error'` → forwarded via `onError`; marker tokens dropped; partial → final promotion; `stop()` timeout path triggers `session.close()`. |
| `renderer.ts` | Drive each renderer with a canned token sequence and a stub `WriteStream` that captures all writes; assert exact byte output. Cases: overwrite padding with shrinking text; TTY downgrade (`isTTY: false`); `dispose()` clears overwrite line; append/final-only never emit `\r`. |

### 10.2 Integration tests (orchestrator end-to-end with stubs)

- Use a `FakeMicSource` that implements `MicSource` and emits a canned PCM `Buffer` on `audio` after `start()` resolves.
- Use a fake Soniox session (either via `vi.mock('@soniox/node')` or by injecting a `Transcriber` factory) that emits canned token sequences and an optional `'error'` event.
- Scenarios:
  - Missing-key path: `main(['node','mic-tool'])` returns 2; stderr matches `MissingConfigurationError`.
  - Help path: `main(['node','mic-tool','--help'])` exits 0 (Commander); stdout lists all flags.
  - Version path: `main(['node','mic-tool','--version'])` exits 0; stdout matches `package.json` version.
  - Happy path: fake tokens flow → renderer captures expected lines.
  - SIGINT simulation: `process.emit('SIGINT')` mid-stream → assert `mic.stop` then `transcriber.stop` then `renderer.dispose` invoked in order; return value 0.
  - Auth error: fake transcriber throws `SonioxAuthError` from `start()` → return value 4.
  - Mid-stream network error: fake transcriber emits `onError(new SonioxNetworkError(...))` → return value 5; shutdown invoked.

### 10.3 CLI shell scripts (no network, no mic — AC-14)

- `test_scripts/test-help.sh`, `test-version.sh`, `test-missing-key.sh` — already specified in plan-001 Phase 4.

---

## 11. Architectural Decisions Log

- **TypeScript strict + ESM** — project convention; matches `@soniox/node` v2 dual-format publish.
- **Node engine `>=20.12`** — required for `process.loadEnvFile()` (programmatic API); avoids `dotenv` runtime dep.
- **`@soniox/node@^2` for the WebSocket path** — 0 declared deps; absorbs auth-frame / framing / keepalive / finish; strongly typed error classes map cleanly to our taxonomy.
- **Spawn `sox` directly** — wrappers (`node-record-lpcm16`, `mic`) are abandoned; `naudiodon` needs native build on Apple Silicon; direct spawn yields zero npm deps and the exact `pcm_s16le` output Soniox wants.
- **Commander v14 for CLI** — zero deps; built-in `--help`/`--version`; idiomatic.
- **`.env` wins over shell env** — explicit FR-5 contract; implemented via `process.loadEnvFile()` overwriting `process.env`.
- **No fallback for missing config** — NFR-5 / project rule; every missing-required-config path raises `MissingConfigurationError`.
- **Connect timeout 5 000 ms (override SDK default 20 000)** — makes AC-10 network-failure assertions feasible without hanging tests.
- **Drop audio when `session.state !== "connected"`** — simpler than a buffer; the window is tiny (shutdown only); v1 acceptably loses ~30 ms of audio at session end.
- **1.5 s shutdown timeout around `session.finish()`** — guards against the SDK's open question on `finish()` deadlocks; falls back to `session.close()`.
- **Per-token partial/final discrimination** — matches the SDK's documented finality model (per-token `is_final`, not per-message).
- **`<end>` and `<fin>` filtered in Unit C, double-filtered in Unit D** — defence in depth.
- **TTY-vs-pipe auto-downgrade of `overwrite` → `append`** — satisfies AC-12 even when the user explicitly chooses `overwrite` while piping; no `\r` ever written to a non-TTY.
- **`MicNotAvailableError` and `MicPermissionDeniedError` share exit code 3** — both are "no audio is reaching the wrapper"; the error message text differentiates them for the user; reduces exit-code surface vs the plan's 3/4 split.
- **No auto-reconnect on WS drop** — explicit v1 fail-fast decision; mid-stream `NetworkError`/`ConnectionError` map to `SonioxNetworkError` and trigger shutdown.
- **Pre-connect one-shot `'error'` listener + try/catch around `connect()`** — defends against the open SDK question of whether auth errors arrive thrown or emitted.
- **Mic source emits `'error'` via `EventEmitter`, not a constructor callback** — keeps the `MicSource` interface narrow; the orchestrator subscribes after `start()` resolves.
- **`main(argv)` returns the exit code; `index.ts` calls `process.exit`** — keeps `main` testable (no process side-effect in unit tests).
- **`renderer.dispose()` clears the current overwrite line** — leaves the shell prompt clean on exit; defensive in all modes.

---

## 12. Turn Detection (added by plan-002)

### 12.1 Goal
Replace the always-continuous stream model with a *turn*-based model. A turn ends when a configurable guard phrase appears in the recent finalized transcript. On detection, the renderer emits a single blank line on stdout and the detector starts a new turn.

### 12.2 Module layout
- `src/turn/detector.ts` — `GuardPhraseTurnDetector` and the `TurnAwareRenderer` interface (`partial` / `final` / `dispose`).
- `src/render/renderer.ts` — adds `turnBoundary()` (and `refined()`, see §13) to the `Renderer` interface.

### 12.3 Normalization algorithm
Both the rolling buffer and the configured guard phrase are passed through `normalizeForMatch`:

```
input  → NFD                    (decompose accents into base + combining marks)
       → strip /\p{M}+/gu        (remove combining marks: τέλος → τελος)
       → toLowerCase
       → replace /[^\p{L}\p{N}]+/gu → single space  (punctuation/whitespace collapsed)
       → trim
```

Examples:
- `"Τέλος εντολής!"` → `"τελος εντολης"`
- `"  the END.  "`   → `"the end"`

The same routine is mirrored in `src/config.ts` (`normalizeGuardPhrase`) so the config layer can reject phrases that normalize to an empty string (e.g. `"!!!"`).

### 12.4 Rolling buffer
- Each `final(text)` appends to `buffer` (space-separated).
- When `buffer.length > 2000` characters, the head is trimmed; only recent context matters for the match.
- On a successful match: `renderer.turnBoundary()` is called, `buffer` is reset to `""`, and the captured pre-reset text is forwarded to LLM refinement (see §13).
- `partial(text)` is passed through unchanged — never inspected for the phrase.

### 12.5 Renderer contract: `turnBoundary()`
In all three output modes (`overwrite`, `append`, `final-only`) the preceding `final()` already terminated its line with `\n`, so `turnBoundary()` writes exactly one additional `\n` — yielding a single blank line. No-op after `dispose()`.

### 12.6 Orchestrator wiring
`src/main.ts` constructs the inner `StdoutRenderer`, wraps it in `GuardPhraseTurnDetector`, then passes the wrapper to the Soniox transcriber's `onPartial` / `onFinal` callbacks. Shutdown disposes the wrapper, which in turn disposes the inner renderer and the LLM refiner.

---

## 13. LLM Refinement (added by plan-003)

### 13.1 Goal
After each turn closes (guard-phrase fire), send the turn's verbatim text to a configured LLM and render the cleaned version on its own line followed by an additional blank line. Refinement is asynchronous and fail-open: transcription never blocks on it; failures are logged and skipped.

### 13.2 Rendering contract

```
<finals containing τέλος εντολής>\n
                                   ← blank line from turnBoundary()
<refined text>\n
                                   ← additional blank line under the refinement
```

If refinement is disabled, fails, or the renderer is disposed before resolution, only the turn-boundary blank line appears — the verbatim transcript is the user's fallback.

### 13.3 `LLMRefiner` interface
Defined in `src/llm/types.ts`:

```ts
export interface LLMRefiner {
  refine(text: string): Promise<string>;
  dispose(): void;
}
```

Implementations MUST honour `requestTimeoutMs` via `AbortController`, return whitespace-trimmed text on success, and abort any in-flight request when `dispose()` is called.

### 13.4 Eight standard providers
The `LLMProvider` union enumerates the eight standard provider names required by the project's tool conventions (vendor-canonical):

| Provider name         | v1 status              | Required env vars when implemented                              |
|-----------------------|------------------------|-----------------------------------------------------------------|
| `azure-openai`        | Fully implemented      | `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, (`AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION` optional) |
| `openai`              | Stubbed (throws at construction) | `OPENAI_API_KEY`                                               |
| `anthropic`           | Stubbed                | `ANTHROPIC_API_KEY`                                             |
| `google`              | Stubbed                | `GOOGLE_API_KEY`                                                |
| `azure-ai-inference`  | Stubbed                | `AZURE_AI_INFERENCE_ENDPOINT`, `AZURE_AI_INFERENCE_API_KEY`     |
| `ollama`              | Stubbed                | `OLLAMA_HOST`                                                   |
| `litellm`             | Stubbed                | `LITELLM_BASE_URL`, `LITELLM_API_KEY`                           |
| `openai-compat`       | Stubbed                | `OPENAI_COMPAT_BASE_URL`, `OPENAI_COMPAT_API_KEY`               |

### 13.5 Factory dispatch (`src/llm/factory.ts`)
```
createRefiner(cfg: LLMConfig): LLMRefiner | null
```
- Returns `null` when `cfg.enabled === false`.
- Dispatches to `AzureOpenAIRefiner` for `azure-openai`.
- For any other provider, throws `LLMConfigurationError` with a "not implemented in v1" message that names the env vars to set when the provider lands. This is a startup-fatal error (exit 2).

### 13.6 Azure OpenAI refiner (`src/llm/azureOpenAI.ts`)
- Endpoint: `POST {endpoint}/openai/deployments/{deployment}/chat/completions?api-version={apiVersion}`
- Headers: `api-key: {key}`, `Content-Type: application/json`
- Body: `{ messages: [{role: "system", content: systemPrompt}, {role: "user", content: text}], temperature: 0.2 }`
- Transport: native Node 20 `fetch`. Two `AbortController`s — one per request (with a `setTimeout` driving the `requestTimeoutMs`) and a class-level `lifetimeAbort` that `dispose()` triggers to drop every in-flight request at shutdown.
- Default system prompt (cleanup):
  > You are a transcript-cleanup assistant. The input is a verbatim transcript of someone speaking and may contain disfluencies, filler words, false starts, and grammatical noise. Rewrite the text so it is grammatically correct and easy to read, preserving the speaker's meaning AND the original language. Respond with ONLY the cleaned text — no preamble, no quotes, no markdown, no explanation.

### 13.7 Error mapping (HTTP / network → `LLMRefinementError.kind`)
- `401`, `403`                       → `"auth"`
- `408`, `429`, `5xx`                 → `"server"`
- Timeout (AbortError or "timed out") → `"timeout"`
- Any other fetch rejection          → `"network"`
- Missing `choices[0].message.content`, JSON-parse failure → `"shape"`

All five sub-codes are runtime-only (non-fatal). The orchestrator logs them under `--verbose` tagged `llm-<kind>` and otherwise swallows them. See NFR-10.

### 13.8 Asynchronous fire-and-forget
`GuardPhraseTurnDetector.maybeRefine(turnText)`:

1. Captures `buffer` BEFORE the reset (this is the turn text).
2. Strips the guard phrase from the captured text using a tolerant matcher (case-insensitive literal first; falls back to normalized-match with trailing-fragment removal).
3. If stripped text is empty, returns early.
4. Calls `refiner.refine(stripped)` inside `void (async () => { ... })()`. Never awaited from `final()`.
5. On resolve: `if (!disposed) renderer.refined(text)`.
6. On reject: log under verbose; otherwise silent.

### 13.9 Renderer contract: `refined(text)`
- `overwrite` mode: if `prevLen > 0` (an in-progress partial of the *next* turn is already on screen), write a `\n` first to commit it and reset `prevLen = 0`. Then write `text + "\n\n"`.
- `append` / `final-only`: write `text + "\n\n"`.
- No-op after `dispose()` or for empty text.
- Defensive in-progress-partial handling matters because refinement is async — a new partial may have rendered while the LLM call was in flight.

---

## 14. Configuration & Four-Tier Env-Var Chain (added by plan-004)

### 14.1 Resolution priority
```
+----------------------+   highest priority
| 1. CLI flag          |
+----------------------+
| 2. <cwd>/.env        |
+----------------------+
| 3. ~/.tool-agents/   |
|    mic-tool/.env     |   (mode 0700 / 0600 — secrets)
+----------------------+
| 4. process.env       |
+----------------------+   lowest priority
```

Implementation: `src/config/envChain.ts` exports `loadEnvChain({ toolName })` which returns an `EnvChain` view with `get(key)` (value + source tag) and `value(key)` (just the value). The chain never mutates `process.env`.

### 14.2 Authoritative config schema

| CLI flag                            | Env var                                | Default                                              | Parser / validator |
|-------------------------------------|----------------------------------------|------------------------------------------------------|--------------------|
| `--api-key <value>`                 | `SONIOX_API_KEY`                       | _required_ (no fallback; throws `MissingConfigurationError`, exit 2) | trim, non-empty |
| `--api-key-expires-at <YYYY-MM-DD>` | `SONIOX_API_KEY_EXPIRES_AT`            | _unset_                                              | `parseIsoDate` (round-trips via `Date.UTC`) |
| `--model <name>`                    | `MIC_TOOL_MODEL`                       | `stt-rt-v4`                                          | trim, non-empty |
| `--endpoint <wss-url>`              | `MIC_TOOL_ENDPOINT`                    | `wss://stt-rt.soniox.com/transcribe-websocket`       | `parseWsUrl` (must be `wss://` or `ws://`) |
| `--language <code>` (repeatable)    | `MIC_TOOL_LANGUAGES` (CSV)             | `el,en`                                              | `validateLanguages` (ISO 639-1/2 OR sole `auto`) |
| `--sample-rate <hz>`                | `MIC_TOOL_SAMPLE_RATE`                 | `16000`                                              | `parsePositiveInt`, range `[8000, 48000]` |
| `--no-endpoint-detection`           | `MIC_TOOL_ENABLE_ENDPOINT_DETECTION`   | `true`                                               | `parseBoolean` |
| `--output-mode <mode>`              | `MIC_TOOL_OUTPUT_MODE`                 | `overwrite`                                          | one of `overwrite`/`append`/`final-only`; auto-downgrades to `append` when stdout is piped |
| `--guard-phrase <phrase>`           | `MIC_TOOL_GUARD_PHRASE`                | `τέλος εντολής`                                      | trim, non-empty after `normalizeGuardPhrase` |
| `--refine` / `--no-refine`          | `MIC_TOOL_REFINE`                      | `true`                                               | `parseBoolean` |
| `--llm-provider <name>`             | `MIC_TOOL_LLM_PROVIDER`                | `azure-openai`                                       | one of the eight `LLM_PROVIDERS`; non-Azure stubbed |
| `--llm-model <name>`                | `MIC_TOOL_LLM_MODEL`                   | `gpt-5.4`                                            | trim, non-empty |
| `-v, --verbose`                     | `MIC_TOOL_VERBOSE`                     | `false`                                              | `parseBoolean` |

Provider-specific env vars consulted only when `--refine` is on and the provider is `azure-openai`:

| Env var                       | Required? | Default                |
|-------------------------------|-----------|------------------------|
| `AZURE_OPENAI_API_KEY`        | yes       | —                      |
| `AZURE_OPENAI_ENDPOINT`       | yes       | —                      |
| `AZURE_OPENAI_DEPLOYMENT`     | no        | falls back to `--llm-model` value |
| `AZURE_OPENAI_API_VERSION`    | no        | `2024-10-21`           |

### 14.3 Parsers module (`src/config/parsers.ts`)
Single helper surface for every typed coercion. Each helper takes `(raw, flagName, envName)` so the thrown `InvalidConfigurationError` message can name both — the user never has to guess which knob to turn.

- `parseBoolean` — accepts `true|false|yes|no|on|off|1|0` (case-insensitive).
- `parsePositiveInt` — `^[0-9]+$`; optional `[min, max]`.
- `parseCsvNonEmpty` — splits on `,`, trims, drops empties; throws if zero items remain.
- `parseIsoDate` — `^\d{4}-\d{2}-\d{2}$`; round-trips through `Date.UTC` so `2026-02-30` is rejected.
- `parseWsUrl` — `^wss?://[^\s]+$`.

### 14.4 Expiry helper (`src/config/expiry.ts`)
- `evaluateExpiry(isoDate, now=new Date())` → `{ level: "ok" | "soon" | "expired", daysUntil }` where `soon` covers a 14-day window.
- `warnAboutExpiry(isoDate, verbose, write?, now?)` writes a single stderr line at `"soon"` and `"expired"` levels (always), and at `"ok"` only under `--verbose`. The tool does NOT block on expiry — the user owns renewal.
- v1 wires this for `SONIOX_API_KEY_EXPIRES_AT` only. An analogous `AZURE_OPENAI_API_KEY_EXPIRES_AT` is documented for future use (see `Issues - Pending Items.md`).

### 14.5 Validators in `src/config.ts`
- `validateLanguages([...])` — each item matches `^[a-z]{2,3}(-[A-Z]{2})?$` OR is the literal `auto`; if `auto` is in the list, no other code may be present.
- `validateOutputMode(value)` — one of the three string literals.
- `validateGuardPhrase(value)` — trimmed length > 0 AND `normalizeGuardPhrase(value).length > 0`.
- `validateLLMProvider(value)` — must be in the eight-name enum.
- `resolveProviderConfig(provider, model, chain)` — for `azure-openai`, collects the four Azure env vars; if either of the two required ones is missing, throws `LLMConfigurationError` enumerating the missing names AND the four-tier search order so the user can fix whichever they prefer.

### 14.6 Where defaults live
Defaults are declared as module-level constants near the top of `src/config.ts` (`DEFAULT_MODEL`, `DEFAULT_ENDPOINT`, `DEFAULT_LANGUAGES_CSV`, `DEFAULT_SAMPLE_RATE`, `DEFAULT_OUTPUT_MODE`, `DEFAULT_GUARD_PHRASE`, `DEFAULT_LLM_PROVIDER`, `DEFAULT_LLM_MODEL`, `DEFAULT_LLM_REQUEST_TIMEOUT_MS`, `DEFAULT_AZURE_API_VERSION`, `DEFAULT_SYSTEM_PROMPT`). The resolver layer ONLY substitutes a default when (a) the CLI flag is absent AND (b) the env chain does not yield a value. There is no other fallback path — per NFR-5 / NFR-8 a missing *required* value raises, never substitutes silently.

### 14.7 Verbose diagnostics
When `--verbose` is set, the resolver emits (to stderr) one line per family:
- `[mic-tool] api key loaded from: <flag|.env|user|env>`
- `[mic-tool] guard phrase: <phrase>`
- `[mic-tool] transcription: model=..., endpoint=..., languages=[...], sample_rate=..., endpoint_detection=...`
- `[mic-tool] llm: enabled|disabled (provider=..., model=...)`

The API key value itself is NEVER logged.

---

## 15. Architectural Decisions Log — additions from plans 002, 003, 004

### Plan 002 (turn detection)
- **Guard phrase remains visible in the rendered final.** Users want a clear audit trail of what triggered the turn end. The phrase is only stripped from the LLM input, not the user-visible transcript.
- **Rolling buffer (max 2000 chars), not just the latest final.** A natural pause can split the phrase across two final tokens (`"τέλος"` followed seconds later by `"εντολής"`); the rolling buffer keeps recent context so cross-final matches succeed.
- **Tolerant normalization (NFD + strip combining + lowercase + collapse punctuation).** Greek finals from Soniox vary in accents and trailing punctuation depending on lexicon; tolerating all of it avoids "obviously matching" matches being missed.
- **No-streaming, no-rollback turn detector.** A turn boundary is a single committed event; we do not retract finals from before the boundary even if a later final invalidates the match window.

### Plan 003 (LLM refinement)
- **Eight standard provider names enumerated in the type.** Even when most are stubs, listing them in the union keeps the contract honest with the project-wide tool conventions; future implementations slot in without a type churn.
- **Only `azure-openai` fully implemented in v1.** Reduces surface area for the first release; the seven stubs throw a useful "set X env vars and add a refiner" message at construction so users know exactly what is missing.
- **Refinement is fail-open at runtime, fail-closed at startup.** A flaky LLM call must not break dictation (NFR-10); a missing required Azure env var when refine is on is unambiguous misconfiguration and is fatal (NFR-8).
- **Per-request `AbortController` + class-level `lifetimeAbort`.** Two controllers cleanly express "drop this one request after T ms" and "drop every in-flight request at shutdown" without conflating them.
- **No SDK dependency for Azure OpenAI.** Native `fetch` (Node 20+) covers the Chat Completions REST surface in ~40 lines; the official SDK would add a transitive dependency tree larger than the rest of the tool combined.
- **Async fire-and-forget via `void (async () => ...)()`.** Refinement runs on the microtask queue; the next utterance can be transcribed immediately. The renderer's `refined()` guards against the next-turn-partial-already-rendered race in overwrite mode.
- **Default system prompt enforces language preservation.** The prompt asks the model to keep the speaker's original language; this matters for Greek where a default-tuned cleanup model might English-ify.

### Plan 004 (full env-var fallbacks + key expiry)
- **Four tiers, with `<cwd>/.env` beating `~/.tool-agents/.../.env` beating shell env.** Project-local config takes precedence so per-project overrides don't require touching shared user files; the per-user `~/.tool-agents/<tool>/.env` is the canonical secrets store, mandated by the project's tool conventions.
- **Never mutate `process.env`.** Tests stay isolated and precedence is deterministic — the alternative (`process.loadEnvFile()`) would silently refuse to overwrite an existing shell var, inverting the desired priority.
- **Whitespace-only env values are treated as missing.** A `.env` file with `SONIOX_API_KEY=   ` is far more likely to be a copy-paste mistake than a deliberate blank value.
- **No auto-create of `~/.tool-agents/mic-tool/`.** The tool reads the folder if it exists; creating it (with the required 0700 mode + a 0600 `.env`) is a one-time user operation documented in the configuration guide, not a runtime side-effect.
- **Sample rate parameterized everywhere (sox argv + Soniox session).** A single config value drives both, so they can never drift; validated `[8000, 48000]` to match the realistic envelope of the Soniox real-time model.
- **Operational expiry tracking, not enforcement.** The tool warns at 14 days and at zero, but always tries to run. Hard-failing on a stale ISO date would punish users for the failure mode "I forgot to update the reminder, not the key."
- **Both flag and env-var name in every parser error message.** Reduces the back-and-forth of "where do I fix this" when an `.env` value is bad — the error names both knobs.

---

## 16. Open Items Carried Forward to Implementation

These do not block the design but should be revisited during Phase 5:

- The exit-code mapping in this design differs from `plan-001` (consolidated mic codes; renumbered network/protocol/auth). The plan file should be updated during Phase 8 (docs finalisation) — **not** by this design pass.
- `RealtimeUtteranceBuffer` from the SDK is not used; Unit C maintains its own minimal `partialBuffer`. If utterance segmentation gets richer in v2, switching to `RealtimeUtteranceBuffer` is a localized change in `client.ts`.
- `total_audio_proc_ms` verbose-mode logging (mentioned as nice-to-have in research §6) is deferred — not in v1 scope.
- A `--keepalive-interval-ms` hidden flag is deferred — SDK default of 5 000 ms is correct for v1 (audio-as-keepalive during active capture means it never triggers anyway).
