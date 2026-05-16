# mic-tool-ts — Technical Design

**Document status**: Authoritative implementation specification for v1.
**Audience**: The engineer implementing Units A–E in Phase 5 of `plan-001-soniox-mic-cli.md`.
**Goal**: A coder picking up any one unit should be able to write it without re-reading the SDK research or investigation docs.

---

## 1. System Overview

### Elevator summary

`mic-tool-ts` is a direct OS-command TypeScript CLI for macOS that captures live microphone audio with a spawned `sox` process, streams it as `pcm_s16le` 16 kHz mono PCM through the `@soniox/node` v2 WebSocket SDK to Soniox's `stt-rt-v4` real-time model, and renders the returned partial and final tokens to `stdout` in one of three modes (`overwrite`, `append`, `final-only`). The package name and installed command are both `mic-tool-ts`; the per-user configuration folder is `~/.tool-agents/mic-tool-ts/`; project-specific env vars use the `MIC_TOOL_TS_*` prefix. The tool has no hidden defaults for required config: the Soniox API key is resolved deterministically through CLI flag > local `.env` > per-user tool `.env` > shell env, and a missing key raises a typed `MicToolError` subclass with a stable exit code. SIGINT triggers a bounded graceful shutdown that finalises pending partials, drains finals, and closes the WebSocket within 1.5 s.

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

- **Purpose**: Parse `argv` via Commander; resolve configuration through the four-tier chain implemented in `src/config/envChain.ts`; validate every typed value; produce a frozen `ResolvedConfig`.
- **Public interface**: `resolveConfig(argv: string[]): ResolvedConfig` and the `ResolvedConfig` type.
- **Internal design**:
  - The binary name is `mic-tool-ts`, and the installed package exposes the same name in `package.json` `bin`.
  - Commander definitions live inside `resolveConfig` (no module-level side effects).
  - The Commander program intercepts `--help` and `--version` through `exitOverride()` and surfaces `HelpOrVersionShown`, so `main()` owns exit-code mapping.
  - `loadEnvChain({ toolName: "mic-tool-ts" })` reads `<cwd>/.env`, `~/.tool-agents/mic-tool-ts/.env`, and `process.env` without mutating `process.env`.
  - All validation happens after argv parsing and env-chain construction, before constructing `ResolvedConfig`.
  - `--verbose` log lines write to `stderr`; the key value itself is **never** logged.
- **Error responsibilities**:
  - **Raises**: `MissingConfigurationError` (no Soniox API key found in any source), `InvalidConfigurationError` (bad typed value), `LLMConfigurationError` (required Azure OpenAI settings missing while refinement is enabled), `HelpOrVersionShown`.
  - **Does not mutate**: `process.env`.

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
export type SttProvider = "soniox" | "elevenlabs";

export interface ResolvedConfig {
  /** Active realtime transcription provider. */
  readonly sttProvider: SttProvider;

  /** Active provider API key. Guaranteed non-empty after trim. */
  readonly apiKey: string;

  /** Active provider API-key env var name. */
  readonly apiKeyEnvName: "SONIOX_API_KEY" | "ELEVENLABS_API_KEY";

  /** Optional YYYY-MM-DD reminder for the active provider API-key renewal. */
  readonly apiKeyExpiresAt?: string;

  /** Active provider realtime model name. */
  readonly model: string;

  /** Active provider WebSocket endpoint. */
  readonly endpoint: string;

  /** Language hints OR the single literal "auto". */
  readonly languages: string[];

  /** PCM sample rate fed to sox and to the active provider. */
  readonly sampleRate: number;

  /** Whether provider endpoint/VAD detection is enabled. */
  readonly enableEndpointDetection: boolean;

  /** Stdout rendering mode. */
  readonly outputMode: OutputMode;

  /** Guard phrase that closes the current turn. */
  readonly guardPhrase: string;

  /** LLM refinement settings. */
  readonly llm: LLMConfig;

  /** Diagnostic logging to stderr. */
  readonly verbose: boolean;
}

/**
 * Resolves CLI args + the four-tier env chain into a frozen ResolvedConfig.
 *
 * @throws {MissingConfigurationError} when the active provider API key is missing.
 * @throws {InvalidConfigurationError} on invalid typed config.
 * @throws {LLMConfigurationError} when enabled LLM config is incomplete.
 * @throws {HelpOrVersionShown} when Commander prints help/version.
 */
export function resolveConfig(argv: string[]): ResolvedConfig;
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

### 3.3 `Transcriber` (from `src/transcription/types.ts`)

```ts
export type SttProvider = "soniox" | "elevenlabs";

export interface Transcriber {
  /** Open the provider realtime transcription session. */
  start(): Promise<void>;

  /** Forward a chunk of PCM s16le mono audio to the live session. */
  pushAudio(chunk: Buffer): void;

  /** Gracefully finalize and close the session. Idempotent. */
  stop(): Promise<void>;

  onPartial(cb: (text: string) => void): void;
  onFinal(cb: (text: string) => void): void;
  onError(cb: (err: Error) => void): void;
}

export function createTranscriber(opts: TranscriberOptions): Transcriber;
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

/** ElevenLabs rejected the API key or realtime access. */
export class ElevenLabsAuthError extends MicToolError {
  constructor(message: string) { super(message, 4); }
}

/** ElevenLabs unreachable (DNS, refused, timeout, mid-stream drop). */
export class ElevenLabsNetworkError extends MicToolError {
  constructor(message: string) { super(message, 5); }
}

/** ElevenLabs returned a protocol-level error (bad config, quota, rate limit). */
export class ElevenLabsProtocolError extends MicToolError {
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

1. CLI flag.
2. `.env` file at `path.resolve(process.cwd(), ".env")`.
3. `~/.tool-agents/mic-tool-ts/.env`.
4. `process.env` (the shell environment).

`src/config/envChain.ts` owns the env-chain implementation. It parses `.env` files into an internal map and never calls `process.loadEnvFile()`, because mutating `process.env` would make precedence dependent on host state and would make tests harder to isolate.

### 4.2 Safe `.env` loading

Both `.env` files are optional. Missing files are treated as absent values. Read or parse failures raise `InvalidConfigurationError` with the path in the message, so a malformed file is never silently ignored.

The per-user config segment is fixed to `mic-tool-ts`; the runtime call is `loadEnvChain({ toolName: "mic-tool-ts" })`. The tool reads the folder but does not auto-create it.

### 4.3 Validation rules (per field)

| Field | Rule | Error on violation |
|---|---|---|
| `apiKey` | `typeof v === "string" && v.trim().length > 0` | `MissingConfigurationError("SONIOX_API_KEY is not set. Provide it via --api-key <key>, a .env file in the working directory, or the SONIOX_API_KEY environment variable.")` |
| `languages` | Each item is `auto` OR `/^[a-z]{2,3}(-[A-Z]{2})?$/`; `auto` cannot be combined with other hints. | `InvalidConfigurationError("--language must be 'auto' or an ISO 639-1/2 code ...")` |
| `outputMode` | One of `"overwrite" | "append" | "final-only"` | `InvalidConfigurationError` |
| `verbose` | Strict boolean parser (`true|false|yes|no|on|off|1|0`) | `InvalidConfigurationError` |

Defaults are explicit constants in `src/config.ts` and are applied only when the CLI flag is absent and the env chain does not provide a value. Required settings, such as `SONIOX_API_KEY` and the Azure OpenAI key/endpoint when refinement is enabled, never receive fallback defaults.

### 4.4 Verbose-mode logging at start

When `cfg.verbose === true`, the resolver and orchestrator write lifecycle diagnostics to stderr:

```
[mic-tool-ts] api key loaded from: <flag|.env|user|env>
[mic-tool-ts] guard phrase: <phrase>
[mic-tool-ts] transcription: model=<v>, endpoint=<v>, languages=[...], sample_rate=<n>, endpoint_detection=<bool>
[mic-tool-ts] llm: enabled|disabled (provider=<v>, model=<v>)
[mic-tool-ts] platform=darwin, node=<version>
```

**The key value is never logged. Only its source name (`flag`, `.env`, `user`, `env`) is logged.**

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
      "Microphone access denied. Grant access in System Settings > Privacy & Security > Microphone, then re-run mic-tool-ts."
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
const languageOpts = cfg.languages.length === 1 && cfg.languages[0] === "auto"
  ? { enable_language_identification: true as const }
  : { language_hints: cfg.languages };

const session = client.realtime.stt(
  {
    model: cfg.model,
    audio_format: "pcm_s16le",
    sample_rate: cfg.sampleRate,
    num_channels: 1,
    enable_endpoint_detection: cfg.enableEndpointDetection,
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
      process.stderr.write(`[mic-tool-ts] dropped ${chunk.length} audio bytes (session not connected)\n`);
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
private committedFinals = "";

private onResult(result: RealtimeResult): void {
  let incomingFinals = "";
  let currentNonFinals = "";

  for (const tok of result.tokens) {
    if (tok.text === "<end>" || tok.text === "<fin>") continue;  // marker filter
    if (tok.is_final) incomingFinals += tok.text;
    else currentNonFinals += tok.text;
  }

  if (incomingFinals.length > 0) {
    this.committedFinals = mergeFinalText(this.committedFinals, incomingFinals);
  }

  const display = this.committedFinals + currentNonFinals;
  if (display.length > 0) this.callbacks.onPartial(display);
}

function mergeFinalText(committed: string, incomingFinals: string): string {
  if (incomingFinals.startsWith(committed)) return incomingFinals; // snapshot
  if (committed.endsWith(incomingFinals)) return committed;        // duplicate delta
  return committed + incomingFinals.slice(longestOverlap(committed, incomingFinals));
}
```

The adapter treats Soniox result frames defensively as either deltas or current utterance snapshots. Non-final text is rebuilt from the current result. Final text is merged into `committedFinals` without appending a repeated finalized prefix. Endpoint / finalized events commit `committedFinals` as the final utterance and reset the buffer. The renderer's three modes consume these two callbacks differently (§7).

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

State: `prevLineLen: number` (visible length of the last overwrite snapshot), `prevRows: number` (physical terminal rows occupied by the last overwrite snapshot), and `lastPartialText: string | null` (last interim snapshot rendered).

Single-row updates use the classic carriage-return overwrite path with trailing spaces when the new snapshot is shorter. When the previous snapshot wrapped across multiple terminal rows, the renderer moves the cursor back to the first row of that overwrite region, clears every row the previous snapshot occupied, returns to the first row, and writes the latest snapshot once. Terminal width comes from the TTY stream's `columns` value, falling back to `process.stdout.columns` and then `80` if no valid value is available.

```ts
partial(text: string): void {
  if (text === this.lastPartialText) return;
  this.lastPartialText = text;
  const prefix = overwritePrefix(this.prevRows); // "\r" for 0-1 rows; ANSI clear/reposition for >1.
  const textLen = visibleLength(text);
  const padding = this.prevRows <= 1 ? Math.max(0, this.prevLineLen - textLen) : 0;
  this.stdout.write(prefix + text + " ".repeat(padding));
  this.prevLineLen = textLen;
  this.prevRows = rowsForText(text);
}

final(text: string): void {
  this.lastPartialText = null;
  const prefix = overwritePrefix(this.prevRows);
  const textLen = visibleLength(text);
  const padding = this.prevRows <= 1 ? Math.max(0, this.prevLineLen - textLen) : 0;
  this.stdout.write(prefix + text + " ".repeat(padding) + "\n");
  this.prevLineLen = 0;
  this.prevRows = 0;
}

dispose(): void {
  // Terminate any in-progress overwrite region before exit so the shell prompt is clean.
  if (this.prevLineLen > 0) {
    this.stdout.write("\n");
    this.prevLineLen = 0;
    this.prevRows = 0;
  }
  this.stdout.write("\x1b[2K\r");
}
```

#### `append`

```ts
partial(text: string): void {
  if (text === this.lastPartialText) return;
  this.lastPartialText = text;
  this.stdout.write(text + "\n");
}
final(text: string):   void {
  this.lastPartialText = null;
  this.stdout.write(text + "\n");
}
dispose(): void {}
```

Every non-duplicate consecutive `onPartial` and every `onFinal` from Unit C produces exactly one line. Maximally pipe-friendly while avoiding repeated identical interim snapshots.

#### `final-only`

```ts
partial(text: string): void { /* no-op */ }
final(text: string):   void { this.stdout.write(text + "\n"); }
dispose(): void {}
```

Cleanest pipe output; one line per utterance.

### 7.1.1 Duplicate partial suppression

Realtime STT providers can send the same partial snapshot repeatedly while they wait for more audio or finalization. `StdoutRenderer` suppresses identical consecutive partial strings in all modes that render partials. `final()`, `turnBoundary()`, `refined()`, and `dispose()` reset the duplicate-partial cache so the same text can still appear in a later utterance or section.

### 7.1.2 Wrapped overwrite cleanup

`overwrite` mode is only active on a TTY. If a live partial exceeds the terminal width, a plain `\r` can only return to the beginning of the current physical row; it cannot clear the wrapped rows above it. `StdoutRenderer` therefore tracks the number of physical rows used by the previous overwrite snapshot. For `prevRows > 1`, the next `partial()` or `final()` emits ANSI cursor movement and clear-line sequences to clear the whole previous region before writing the next snapshot. The same code path is not reachable for pipes because non-TTY `overwrite` is downgraded to `append`.

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

This satisfies AC-12: piping `mic-tool-ts > file.txt` with the default mode produces a file containing only transcript text — no `\r` characters, no ANSI artifacts. Even if the user explicitly passes `--output-mode overwrite` while piping, the downgrade still applies (no `\r` ever written to a non-TTY).

If verbose mode is enabled and the downgrade triggers, the orchestrator logs once to stderr:

```
[mic-tool-ts] stdout is not a TTY: --output-mode overwrite downgraded to 'append'.
```

### 7.3 Marker filter (defence-in-depth)

Unit C already strips `<end>` and `<fin>` before they reach the renderer. The renderer applies the same filter on the text it receives — any text equal to `<end>` or `<fin>` is silently dropped — so a future Unit-C regression cannot leak markers to stdout.

---

## 8. Orchestrator Design (Unit E)

### 8.1 `main(argv)` happy path

Once the Soniox session is connected, the mic source has started, signal handlers are installed, and the mic audio stream is wired into the transcriber, `main()` writes this unconditional operational line to stderr:

```
[mic-tool-ts] Ready to listen. Press Control-C to stop the listening tool.
```

The message intentionally goes to stderr so stdout remains transcript-only for shell redirection and pipelines.

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
    if (cfg?.verbose) process.stderr.write("[mic-tool-ts] shutting down...\n");
    try { await mic?.stop(); } catch { /* swallow */ }
    try { await transcriber?.stop(); } catch { /* swallow */ }
    try { renderer?.dispose(); } catch { /* swallow */ }
  };

  let cfg: ResolvedConfig | undefined;
  try {
    cfg = resolveConfig(argv);
    renderer    = createRenderer(cfg.outputMode, process.stdout);
    transcriber = createTranscriber({
      apiKey: cfg.apiKey,
      model: cfg.model,
      endpoint: cfg.endpoint,
      languages: cfg.languages,
      sampleRate: cfg.sampleRate,
      enableEndpointDetection: cfg.enableEndpointDetection,
      verbose: cfg.verbose,
    });
    mic = createMicSource({ verbose: cfg.verbose, sampleRate: cfg.sampleRate });

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

    process.stderr.write("[mic-tool-ts] Ready to listen. Press Control-C to stop the listening tool.\n");

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
| `config.ts` | argv parsing: every flag combination; four-tier precedence (`flag` > `<cwd>/.env` > `~/.tool-agents/mic-tool-ts/.env` > shell env); missing-key error; invalid typed env values; help/version sentinel; whitespace-only values treated as absent. |
| `soxMicSource.ts` | Mock `child_process.spawn` (return a stub `ChildProcess` with controllable streams + events). Cases: ENOENT on spawn → `MicNotAvailableError`; non-zero exit with `coreaudio` in stderr → `MicPermissionDeniedError`; clean exit during stop → resolves; SIGTERM-then-SIGKILL fallback. |
| `client.ts` | Mock `@soniox/node` module via `vi.mock`. Cases: `connect()` throws `AuthError` → wrapper throws `SonioxAuthError`; pre-connect `'error'` event → mapped & thrown; mid-stream `'error'` → forwarded via `onError`; marker tokens dropped; partial → final promotion; `stop()` timeout path triggers `session.close()`. |
| `renderer.ts` | Drive each renderer with a canned token sequence and a stub `WriteStream` that captures all writes; assert exact byte output. Cases: overwrite padding with shrinking text; wrapped overwrite rows are cleared before repaint; TTY downgrade (`isTTY: false`); `dispose()` clears overwrite line; append/final-only never emit `\r`. |

### 10.2 Integration tests (orchestrator end-to-end with stubs)

- Use a `FakeMicSource` that implements `MicSource` and emits a canned PCM `Buffer` on `audio` after `start()` resolves.
- Use a fake Soniox session (either via `vi.mock('@soniox/node')` or by injecting a `Transcriber` factory) that emits canned token sequences and an optional `'error'` event.
- Scenarios:
  - Missing-key path: `main(['node','mic-tool-ts'])` returns 2; stderr matches `MissingConfigurationError`.
  - Help path: `main(['node','mic-tool-ts','--help'])` exits 0 (Commander); stdout lists all flags.
  - Version path: `main(['node','mic-tool-ts','--version'])` exits 0; stdout matches `package.json` version.
  - Happy path: fake tokens flow → renderer captures expected lines.
  - SIGINT simulation: `process.emit('SIGINT')` mid-stream → assert `mic.stop` then `transcriber.stop` then `renderer.dispose` invoked in order; return value 0.
  - Auth error: fake transcriber throws `SonioxAuthError` from `start()` → return value 4.
  - Mid-stream network error: fake transcriber emits `onError(new SonioxNetworkError(...))` → return value 5; shutdown invoked.

### 10.3 CLI shell scripts (no network, no mic — AC-14)

- `test_scripts/test-help.sh`, `test-version.sh`, `test-missing-key.sh` — already specified in plan-001 Phase 4.

---

## 11. Architectural Decisions Log

- **TypeScript strict + ESM** — project convention; matches `@soniox/node` v2 dual-format publish.
- **Node engine `>=20.12`** — project runtime baseline for the TypeScript CLI and native `fetch` used by Azure OpenAI refinement.
- **`@soniox/node@^2` for the WebSocket path** — 0 declared deps; absorbs auth-frame / framing / keepalive / finish; strongly typed error classes map cleanly to our taxonomy.
- **Spawn `sox` directly** — wrappers (`node-record-lpcm16`, `mic`) are abandoned; `naudiodon` needs native build on Apple Silicon; direct spawn yields zero npm deps and the exact `pcm_s16le` output Soniox wants.
- **Commander v14 for CLI** — zero deps; built-in `--help`/`--version`; idiomatic.
- **Four-tier config chain without mutating `process.env`** — explicit FR-15 contract; implemented by `src/config/envChain.ts` so precedence is deterministic and tests remain isolated.
- **No fallback for missing config** — NFR-5 / project rule; every missing-required-config path raises `MissingConfigurationError`.
- **Connect timeout 5 000 ms (override SDK default 20 000)** — makes AC-10 network-failure assertions feasible without hanging tests.
- **Drop audio when `session.state !== "connected"`** — simpler than a buffer; the window is tiny (shutdown only); v1 acceptably loses ~30 ms of audio at session end.
- **1.5 s shutdown timeout around `session.finish()`** — guards against the SDK's open question on `finish()` deadlocks; falls back to `session.close()`.
- **Per-token partial/final discrimination** — matches the SDK's documented finality model (per-token `is_final`, not per-message).
- **`<end>` and `<fin>` filtered in Unit C, double-filtered in Unit D** — defence in depth.
- **TTY-vs-pipe auto-downgrade of `overwrite` → `append`** — satisfies AC-12 even when the user explicitly chooses `overwrite` while piping; no `\r` ever written to a non-TTY.
- **Wrapped overwrite repainting uses ANSI only on TTYs** — `\r` is sufficient for a single physical row, but wrapped live partials require cursor-up and clear-line sequences to remove stale rows before repainting. This remains pipe-safe because non-TTY `overwrite` is already downgraded to `append`.
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
|    mic-tool-ts/.env     |   (mode 0700 / 0600 — secrets)
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
| `--model <name>`                    | `MIC_TOOL_TS_MODEL`                       | `stt-rt-v4`                                          | trim, non-empty |
| `--endpoint <wss-url>`              | `MIC_TOOL_TS_ENDPOINT`                    | `wss://stt-rt.soniox.com/transcribe-websocket`       | `parseWsUrl` (must be `wss://` or `ws://`) |
| `--language <code>` (repeatable)    | `MIC_TOOL_TS_LANGUAGES` (CSV)             | `el,en`                                              | `validateLanguages` (ISO 639-1/2 OR sole `auto`) |
| `--sample-rate <hz>`                | `MIC_TOOL_TS_SAMPLE_RATE`                 | `16000`                                              | `parsePositiveInt`, range `[8000, 48000]` |
| `--no-endpoint-detection`           | `MIC_TOOL_TS_ENABLE_ENDPOINT_DETECTION`   | `true`                                               | `parseBoolean` |
| `--output-mode <mode>`              | `MIC_TOOL_TS_OUTPUT_MODE`                 | `overwrite`                                          | one of `overwrite`/`append`/`final-only`; auto-downgrades to `append` when stdout is piped |
| `--guard-phrase <phrase>`           | `MIC_TOOL_TS_GUARD_PHRASE`                | `τέλος εντολής`                                      | trim, non-empty after `normalizeGuardPhrase` |
| `--refine` / `--no-refine`          | `MIC_TOOL_TS_REFINE`                      | `true`                                               | `parseBoolean` |
| `--llm-provider <name>`             | `MIC_TOOL_TS_LLM_PROVIDER`                | `azure-openai`                                       | one of the eight `LLM_PROVIDERS`; non-Azure stubbed |
| `--llm-model <name>`                | `MIC_TOOL_TS_LLM_MODEL`                   | `gpt-5.4`                                            | trim, non-empty |
| `-v, --verbose`                     | `MIC_TOOL_TS_VERBOSE`                     | `false`                                              | `parseBoolean` |
| `--stt-provider <name>`             | `MIC_TOOL_TS_STT_PROVIDER`                | `soniox`                                             | `soniox` / `elevenlabs` |
| `--elevenlabs-api-key <value>`      | `ELEVENLABS_API_KEY`                      | required when provider is `elevenlabs`               | trim, non-empty |
| `--elevenlabs-api-key-expires-at <YYYY-MM-DD>` | `ELEVENLABS_API_KEY_EXPIRES_AT` | _unset_                                              | `parseIsoDate` |

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
- `warnAboutExpiry({ envName, isoDate, renewUrl, verbose }, write?, now?)` writes a single stderr line at `"soon"` and `"expired"` levels (always), and at `"ok"` only under `--verbose`. The tool does NOT block on expiry — the user owns renewal.
- v1 wires this for the active STT provider key: `SONIOX_API_KEY_EXPIRES_AT` for Soniox and `ELEVENLABS_API_KEY_EXPIRES_AT` for ElevenLabs. An analogous `AZURE_OPENAI_API_KEY_EXPIRES_AT` is documented for future use (see `Issues - Pending Items.md`).

### 14.5 Validators in `src/config.ts`
- `validateLanguages([...])` — each item matches `^[a-z]{2,3}(-[A-Z]{2})?$` OR is the literal `auto`; if `auto` is in the list, no other code may be present.
- `validateOutputMode(value)` — one of the three string literals.
- `validateGuardPhrase(value)` — trimmed length > 0 AND `normalizeGuardPhrase(value).length > 0`.
- `validateSttProvider(value)` — must be `soniox` or `elevenlabs`.
- `validateLLMProvider(value)` — must be in the eight-name enum.
- `resolveProviderConfig(provider, model, chain)` — for `azure-openai`, collects the four Azure env vars; if either of the two required ones is missing, throws `LLMConfigurationError` enumerating the missing names AND the four-tier search order so the user can fix whichever they prefer.

### 14.6 Where defaults live
Defaults are declared as module-level constants near the top of `src/config.ts` (`DEFAULT_SONIOX_MODEL`, `DEFAULT_SONIOX_ENDPOINT`, `DEFAULT_SONIOX_LANGUAGES_CSV`, `DEFAULT_ELEVENLABS_MODEL`, `DEFAULT_ELEVENLABS_ENDPOINT`, `DEFAULT_ELEVENLABS_LANGUAGES_CSV`, `DEFAULT_SAMPLE_RATE`, `DEFAULT_OUTPUT_MODE`, `DEFAULT_GUARD_PHRASE`, `DEFAULT_LLM_PROVIDER`, `DEFAULT_LLM_MODEL`, `DEFAULT_LLM_REQUEST_TIMEOUT_MS`, `DEFAULT_AZURE_API_VERSION`, `DEFAULT_SYSTEM_PROMPT`). The resolver layer ONLY substitutes a default when (a) the CLI flag is absent AND (b) the env chain does not yield a value. There is no other fallback path — per NFR-5 / NFR-8 a missing *required* value raises, never substitutes silently.

### 14.7 Verbose diagnostics
When `--verbose` is set, the resolver emits (to stderr) one line per family:
- `[mic-tool-ts] <ACTIVE_API_KEY_ENV> loaded from: <flag|.env|user|env>`
- `[mic-tool-ts] guard phrase: <phrase>`
- `[mic-tool-ts] transcription: provider=..., model=..., endpoint=..., languages=[...], sample_rate=..., endpoint_detection=...`
- `[mic-tool-ts] llm: enabled|disabled (provider=..., model=...)`

The API key value itself is NEVER logged.

---

## 15. ElevenLabs STT Provider (added by plan-006)

### 15.1 Provider abstraction
`src/transcription/types.ts` defines the provider-neutral `Transcriber` contract. `src/transcription/factory.ts` dispatches to `SonioxTranscriber` or `ElevenLabsTranscriber` from the resolved `sttProvider`. The orchestrator no longer directly constructs a Soniox client.

### 15.2 Configuration behavior
- `soniox` remains the default provider and continues using `SONIOX_API_KEY`.
- `elevenlabs` is opt-in through `--stt-provider elevenlabs` / `MIC_TOOL_TS_STT_PROVIDER=elevenlabs`.
- When ElevenLabs is selected, `ELEVENLABS_API_KEY` or `--elevenlabs-api-key` is required and `SONIOX_API_KEY` is not required.
- Provider defaults are applied before validation: Soniox uses `stt-rt-v4`, the Soniox realtime endpoint, and `el,en`; ElevenLabs uses `scribe_v2_realtime`, `wss://api.elevenlabs.io/v1/speech-to-text/realtime`, and `auto`.
- ElevenLabs accepts `auto` or one explicit language code because its realtime API exposes a single `language_code` option, not multiple language hints.

### 15.3 ElevenLabs client behavior
`src/elevenlabs/client.ts` uses the `ws` package to connect with the `xi-api-key` header. It builds WebSocket query parameters for `model_id`, `audio_format`, `sample_rate`, `commit_strategy`, optional `language_code`, and `include_timestamps=false`.

The client sends each microphone chunk as an `input_audio_chunk` JSON message with base64 PCM and maps inbound events as follows:

| ElevenLabs event | CLI callback |
|------------------|--------------|
| `partial_transcript` | `onPartial(text)` |
| `committed_transcript` | `onFinal(text.trim())` |
| `committed_transcript_with_timestamps` | `onFinal(text.trim())` |
| `error` | typed ElevenLabs auth/protocol error |
| unexpected close/error | typed ElevenLabs network/auth error |

When endpoint detection is enabled, the client uses ElevenLabs VAD commit strategy. On shutdown it sends a best-effort final `input_audio_chunk` with `commit: true`, then closes the WebSocket within 1500 ms.

## 16. Architectural Decisions Log — additions from plans 002, 003, 004, 005, 006

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
- **No auto-create of `~/.tool-agents/mic-tool-ts/`.** The tool reads the folder if it exists; creating it (with the required 0700 mode + a 0600 `.env`) is a one-time user operation documented in the configuration guide, not a runtime side-effect.
- **Sample rate parameterized everywhere (sox argv + Soniox session).** A single config value drives both, so they can never drift; validated `[8000, 48000]` to match the realistic envelope of the Soniox real-time model.
- **Operational expiry tracking, not enforcement.** The tool warns at 14 days and at zero, but always tries to run. Hard-failing on a stale ISO date would punish users for the failure mode "I forgot to update the reminder, not the key."
- **Both flag and env-var name in every parser error message.** Reduces the back-and-forth of "where do I fix this" when an `.env` value is bad — the error names both knobs.

### Plan 005 (project rename to `mic-tool-ts`)
- **Package name, binary name, config folder, and log prefix all use `mic-tool-ts`.** The rename is user-facing, so installation, help examples, diagnostics, and per-user secret storage must agree on one name.
- **Project-specific env vars use `MIC_TOOL_TS_*`.** This keeps the config namespace aligned with the renamed command. Provider-canonical and vendor env vars (`SONIOX_*`, `AZURE_OPENAI_*`) retain their existing names.
- **Installed use is a direct OS command.** User-facing docs and local agent instructions treat `mic-tool-ts` as the supported invocation on `PATH`; `node`, `tsx`, and package-manager scripts remain development conveniences only.

### Plan 006 (ElevenLabs transcription provider)
- **Soniox remains default.** Existing users keep their current command and config behavior unless they explicitly select ElevenLabs.
- **Direct WebSocket API over ElevenLabs SDK.** The tool already owns mic capture, chunking, lifecycle, rendering, and tests. A small WebSocket adapter avoids pulling a larger provider SDK for a single streaming path.
- **VAD maps to endpoint detection.** The existing guard-phrase turn detector needs timely committed transcript segments; ElevenLabs VAD commit strategy is the closest match to Soniox endpoint detection.
- **Provider-specific required secrets.** Missing `ELEVENLABS_API_KEY` is only fatal when ElevenLabs is selected; missing `SONIOX_API_KEY` is only fatal for the Soniox provider. There is no fallback from one provider's key to another.

---

## 17. Voice Agent Command Protocol

### 17.1 Status
Implemented 2026-05-16.

### 17.2 Design intent
`mic-tool-ts` supports oral communication with downstream agents without sacrificing its current dictation behavior. The implementation separates four concepts:

- Dictation text: continuous plain transcript.
- Text section: the paragraph or section accumulated until `command send`.
- Operator state: persistent toggles such as `refine`, `translate`, and `clipboard`.
- LLM operation: optional cleanup, translation, suggestion, criticism, or another transformation applied to a submitted section.

The current guard-phrase detector is a good fit for simple turn closure, but it should not become the whole protocol. The proposed protocol moves section handling and operator state into a dedicated protocol layer.

### 17.3 Protocol layer
The protocol controller sits above finalized STT callbacks:

| State | Meaning | Marker behavior |
|-------|---------|-----------------|
| `capturing_section` | Current default transcript mode; finalized non-command text accumulates in a section buffer. | `command refine|translate|clipboard` changes operator state; `command status` reports current protocol settings; `command send` submits the section; `command cancel` discards it. |
| `processing_section` | A submitted section is being processed through active operators. | New speech continues into the next section; processing is asynchronous and fail-open. |

Partial STT text is rendered or ignored according to the active mode, but it never triggers protocol state transitions.

### 17.4 Output contract
Agent protocol mode emits JSON Lines rather than plain transcript text:

```json
{"type":"state.changed","seq":1,"key":"refine","value":true}
{"type":"state.changed","seq":2,"key":"translate","value":true,"target_policy":"opposite"}
{"type":"status.reported","seq":3,"operators":{"refine":true,"translate":true,"clipboard":false},"translation_policy":"opposite","pending_section":true}
{"type":"section.processed","seq":4,"section_id":"sec_000001","operators":["refine","translate"],"raw_text":"...","refined_text":"...","source_language":"el","target_language":"en","output_text":"..."}
```

Human transcript text and machine protocol events are not mixed in one stream by default:

- `dictation`: human-facing transcript and processed-section output on stdout.
- `agent-protocol`: JSONL state and section events on stdout, diagnostics on stderr.
- `hybrid`: human-facing transcript on stdout; JSONL protocol events to an explicit `--protocol-output` file.

### 17.5 Configuration sketch
Configuration keys:

| CLI flag | Env var | Default |
|----------|---------|---------|
| `--interaction-mode <dictation|agent-protocol|hybrid>` | `MIC_TOOL_TS_INTERACTION_MODE` | `dictation` |
| `--command-phrase <phrase>` | `MIC_TOOL_TS_COMMAND_PHRASE` | `command` |
| `--section-end-phrase <phrase>` | `MIC_TOOL_TS_SECTION_END_PHRASE` | `command send` |
| `--section-cancel-phrase <phrase>` | `MIC_TOOL_TS_SECTION_CANCEL_PHRASE` | `command cancel` |
| `--literal-next-phrase <phrase>` | `MIC_TOOL_TS_LITERAL_NEXT_PHRASE` | `literal phrase` |
| `--refine-default <on|off>` | `MIC_TOOL_TS_REFINE_DEFAULT` | `off` |
| `--translate-default <on|off>` | `MIC_TOOL_TS_TRANSLATE_DEFAULT` | `off` |
| `--translation-policy <opposite|to-en|to-el>` | `MIC_TOOL_TS_TRANSLATION_POLICY` | `opposite` |
| `--clipboard-default <on|off>` | `MIC_TOOL_TS_CLIPBOARD_DEFAULT` | `off` |
| `--protocol-output <path>` | `MIC_TOOL_TS_PROTOCOL_OUTPUT` | required for `hybrid` |

### 17.6 Implemented module layout
- `src/protocol/types.ts` — event types, interaction modes, operator state, marker config.
- `src/protocol/markerMatcher.ts` — normalized marker matching and marker stripping while preserving slash-marker intent.
- `src/protocol/stateMachine.ts` — section capture, state command parsing, `command status` report, `command send` submit, `command cancel` discard, shutdown cancellation, and protocol settings snapshots.
- `src/protocol/jsonlWriter.ts` — JSONL protocol sink with monotonic `seq` values.
- `src/protocol/controller.ts` — connects renderer, refiner/translator, clipboard sink, and protocol writer.
- `src/protocol/settingsStore.ts` — persists and restores non-secret runtime protocol settings in `~/.tool-agents/mic-tool-ts/state.json`.

The orchestrator constructs `VoiceAgentProtocolController` and routes all finalized STT text through it. In `agent-protocol` mode, partial text and human transcript output are suppressed on stdout; only JSONL protocol events are written there. In `dictation` and `hybrid`, cleaned visible transcript text is still rendered through `StdoutRenderer`.

### 17.7 Status command

`command status` is parsed through the same `command` marker as operator toggles, but it is not an operator and does not mutate state. The state machine emits `status.reported` with the current `refine`, `translate`, and `clipboard` booleans, the active `translation_policy`, and `pending_section` indicating whether the current section buffer contains unsent dictated text. The controller writes this event to the protocol writer in `agent-protocol` and `hybrid` modes. In human-facing modes, it renders a single status line such as:

```text
[mic-tool-ts] status: refine=on, translate=off, clipboard=off, translation_policy=opposite, pending_section=yes
```

### 17.8 Remembered protocol settings

Runtime protocol settings are persisted separately from configuration and secrets. `src/protocol/settingsStore.ts` owns the state file at `~/.tool-agents/mic-tool-ts/state.json`:

```json
{
  "version": 1,
  "saved_at": "2026-05-16T19:30:00.000Z",
  "protocol": {
    "operators": {
      "refine": true,
      "translate": false,
      "clipboard": false
    },
    "translation_policy": "opposite"
  }
}
```

The file intentionally excludes API keys, provider endpoints, prompts, transcript text, section payloads, and processed output. On graceful shutdown, `main()` asks `VoiceAgentProtocolController` for `settingsSnapshot()` after `endSession()` and writes the snapshot. On startup, `main()` loads the persisted state and applies it through `applyPersistedProtocolSettings()`. Each persisted value is used only when the corresponding startup setting came from a built-in default. Explicit CLI flags and env-chain values for `--refine-default`, `--translate-default`, `--clipboard-default`, and `--translation-policy` override saved state.

The store creates the per-user tool folder with mode `0700` and writes `state.json` with mode `0600`. Malformed saved state is treated as configuration corruption and raises `InvalidConfigurationError`; shutdown write failures are reported to stderr but do not block graceful exit.

---

## 18. Open Items Carried Forward to Implementation

These do not block the design but should be revisited during Phase 5:

- The exit-code mapping in this design differs from `plan-001` (consolidated mic codes; renumbered network/protocol/auth). The plan file should be updated during Phase 8 (docs finalisation) — **not** by this design pass.
- `RealtimeUtteranceBuffer` from the SDK is not used; Unit C maintains its own minimal `partialBuffer`. If utterance segmentation gets richer in v2, switching to `RealtimeUtteranceBuffer` is a localized change in `client.ts`.
- `total_audio_proc_ms` verbose-mode logging (mentioned as nice-to-have in research §6) is deferred — not in v1 scope.
- A `--keepalive-interval-ms` hidden flag is deferred — SDK default of 5 000 ms is correct for v1 (audio-as-keepalive during active capture means it never triggers anyway).
