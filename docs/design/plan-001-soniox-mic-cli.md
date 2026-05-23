# plan-001 — Soniox Microphone Transcription CLI (`mic-tool-ts`)

## Purpose
Implementation plan for the `mic-tool-ts` TypeScript CLI that captures macOS microphone audio, streams it to Soniox's real-time STT WebSocket via the `@soniox/node` v2 SDK, and renders partial + final transcripts to `stdout`.

## Inputs (source documents)
- Refined request: `docs/design/refined-request-soniox-mic-transcriber.md` (10 FRs, 7 NFRs, 14 ACs).
- Investigation: `docs/reference/investigation-soniox-mic-cli.md` (stack decision, library choices).
- SDK deep dive: `docs/research/soniox-node-sdk-v2.md` (event surface, error classes, shutdown sequence).
- Project conventions: this project's `CLAUDE.md` and the parent-level CLAUDE.md files.

## Confirmed Decisions (do not revisit)
| Decision | Value |
|---|---|
| Stack | `@soniox/node@^2`, `commander@^14`, Node 20.12+ native `process.loadEnvFile()`, `sox` spawned via `node:child_process` |
| Package manager | `pnpm` |
| Binary name | `mic-tool-ts` |
| Platform v1 | macOS only (Linux/Windows = `NotImplementedError` stubs) |
| WS-drop reconnect | Fail-fast (no auto-reconnect) |
| TypeScript | strict; ESM (`"type": "module"`) |
| Node engine | `>=20.12` |
| Soniox model | `stt-rt-v4` |
| Audio | `pcm_s16le`, 16 kHz, mono |

## Decisions Needed Before Implementation
None. Every blocker raised during research has a resolution captured in this plan or the source documents. The four "clarifying questions" listed at the bottom of `soniox-node-sdk-v2.md` (auth-error timing, finish-event-after-error, disconnect reason content, finalize-during-shutdown timing) are addressed defensively here (catch-both error patterns + timeouts) — they do not block implementation.

---

## Phase Breakdown

Phases 1–4 are sequential setup; Phase 5 is the parallelizable implementation cut (Units A–E); Phases 6–8 are sequential close-out. Phase 9 (manual E2E) requires a human + mic and is the final gate.

### Phase 1 — Scaffold & Dependency Vetting

**Deliverable**: An empty but installable `pnpm` workspace with all chosen dependencies vetted and pinned.

**Files to create**:
- `package.json` — `"type": "module"`, `"engines.node": ">=20.12"`, `"bin": { "mic-tool-ts": "dist/index.js" }`, scripts: `build`, `dev`, `start`, `test`, `lint`, `typecheck`.
- `tsconfig.json` — `strict: true`, `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `outDir: dist`, `rootDir: src`.
- `.gitignore` — `node_modules`, `dist`, `.env`, `*.log`.
- `.env.example` — `SONIOX_API_KEY=` with comment.
- `Issues - Pending Items.md` — root file with "Dependency vetting log" section.

**Dependencies to vet (record vetted-on dates in `Issues - Pending Items.md`)**:
- `@soniox/node` — latest within `^2.x` (verified clean per investigation; 0 declared deps).
- `commander` — latest within `^14.x` (0 declared deps).
- Dev: `typescript@^5`, `tsx@^4`, `@types/node@^20`, `vitest@^2`, `eslint@^9`.
- For `tsx`/`vitest`/`esbuild`: per CLAUDE.md, pull latest stable major and `pnpm audit` clean.

**Acceptance**:
- `pnpm install` exits 0.
- `pnpm audit` reports 0 HIGH-or-above advisories. If any transitive HIGH is found, add a `pnpm.overrides` entry and log the override with its expiry condition in `Issues - Pending Items.md`.

**Verification commands**:
```bash
pnpm install
pnpm audit
pnpm tsc --noEmit
```

**Depends on**: none.

---

### Phase 2 — Skeleton Files & Shared Types

**Deliverable**: All source files exist with stubbed exports so each Unit in Phase 5 can be coded in isolation against stable interfaces.

**Files to create** (empty/stub):
```
src/
  index.ts            # bin entry: #!/usr/bin/env node, calls main()
  main.ts             # orchestrator (Unit E) — stub: export async function main(argv: string[]): Promise<number>
  config.ts           # Unit A — stub: export interface ResolvedConfig {...}; export async function resolveConfig(argv: string[]): Promise<ResolvedConfig>
  errors.ts           # shared error taxonomy
  mic/
    types.ts          # MicSource interface
    soxMicSource.ts   # Unit B — stub class
    index.ts          # factory: createMicSource(): MicSource (picks impl by platform)
  soniox/
    client.ts         # Unit C — stub
  render/
    renderer.ts       # Unit D — stub
```

**`src/errors.ts` — shared error classes**:
```ts
export class MicToolError extends Error {
  constructor(message: string, public readonly exitCode: number) {
    super(message);
    this.name = new.target.name;
  }
}
export class MissingConfigurationError extends MicToolError {
  constructor(message: string) { super(message, 2); }
}
export class MicBackendUnavailableError extends MicToolError {  // sox not installed
  constructor(message: string) { super(message, 3); }
}
export class MicPermissionError extends MicToolError {          // macOS denied mic access
  constructor(message: string) { super(message, 4); }
}
export class AuthenticationError extends MicToolError {         // Soniox AuthError
  constructor(message: string) { super(message, 5); }
}
export class ConnectionError extends MicToolError {             // Soniox ConnectionError/NetworkError before connect
  constructor(message: string) { super(message, 6); }
}
export class StreamDisconnectedError extends MicToolError {     // Soniox NetworkError mid-stream (fail-fast)
  constructor(message: string) { super(message, 7); }
}
export class NotImplementedError extends MicToolError {         // non-macOS platforms
  constructor(message: string) { super(message, 50); }
}
```

**`src/mic/types.ts` — MicSource interface (contract for Units B and E)**:
```ts
import type { Readable } from "node:stream";

export interface MicSource {
  /** Start mic capture. Resolves once the subprocess is running and stdout is readable.
   *  Rejects with MicBackendUnavailableError if the backend binary is missing,
   *  or MicPermissionError if the OS denied mic access. */
  start(): Promise<void>;

  /** Readable stream emitting Buffer chunks of pcm_s16le mono 16 kHz audio.
   *  Only valid after start() resolves. */
  readonly audio: Readable;

  /** Stop mic capture. Idempotent. Resolves once the subprocess has exited. */
  stop(): Promise<void>;
}
```

**`src/soniox/client.ts` — TranscriberClient contract (Unit C public surface)**:
```ts
export interface TranscriberEvents {
  onPartial: (text: string) => void;     // accumulated partial-line text (filtered of <end>/<fin>)
  onFinal: (text: string) => void;       // a committed utterance line (filtered)
  onTokens: (tokens: TokenView[]) => void; // raw per-event token stream for append/final-only modes
  onEndpoint: () => void;                // server detected utterance boundary
  onError: (err: Error) => void;         // any mid-stream WS error (already mapped to MicToolError subclass)
  onClose: () => void;                   // session fully closed
}

export interface TokenView {
  text: string;
  isFinal: boolean;
}

export interface TranscriberConfig {
  apiKey: string;
  language: string;       // "en" | "auto" | ISO code
  verbose: boolean;
}

export interface Transcriber {
  start(events: TranscriberEvents): Promise<void>;  // throws AuthenticationError / ConnectionError
  pushAudio(chunk: Buffer): void;                   // no-op if state != connected
  /** Graceful shutdown: finalize() + finish() with 1.5 s timeout, falling back to close(). */
  stop(): Promise<void>;
}
export function createTranscriber(cfg: TranscriberConfig): Transcriber;
```

**`src/render/renderer.ts` — Renderer contract (Unit D public surface)**:
```ts
export type OutputMode = "overwrite" | "append" | "final-only";

export interface Renderer {
  onTokens(tokens: { text: string; isFinal: boolean }[]): void;
  onEndpoint(): void;
  /** Called on shutdown to flush any committed-but-unprinted state. */
  flush(): void;
}

export function createRenderer(mode: OutputMode, stdout: NodeJS.WriteStream): Renderer;
```

**`src/config.ts` — Config contract (Unit A public surface)**:
```ts
export interface ResolvedConfig {
  apiKey: string;
  language: string;          // default "en"
  outputMode: "overwrite" | "append" | "final-only";  // default "overwrite"
  verbose: boolean;          // default false
}
export async function resolveConfig(argv: string[]): Promise<ResolvedConfig>;
// throws MissingConfigurationError when no API key found
```

**Acceptance**:
- All files compile (`pnpm tsc --noEmit` exits 0) with stub bodies returning `throw new Error("not implemented")`.

**Verification commands**:
```bash
pnpm tsc --noEmit
```

**Depends on**: Phase 1.

---

### Phase 3 — Documentation Stubs

**Deliverable**: Required docs exist with placeholder content so later phases populate them in sync with implementation.

**Files to create**:
- `docs/design/project-design.md` — high-level architecture diagram, module map, lifecycle sequence (config → mic.start → transcriber.start → loop → shutdown), error-class table.
- `docs/design/project-functions.md` — **already created in tandem with this plan** (copy of FR-1..FR-10 + NFR-1..NFR-7 from the refined spec).
- `docs/design/configuration-guide.md` — per CLAUDE.md, covering `SONIOX_API_KEY` (purpose, how to obtain, recommended storage, options), `--language`, `--output-mode`, `--verbose`, precedence order, no-fallback rule.
- `README.md` — prerequisites (`brew install sox`, Node ≥20.12, Soniox account, macOS mic permission), install (`pnpm install`, `pnpm build`), usage examples, all flags, error troubleshooting, known limitations (terminal `\r` behavior differs between iTerm and VS Code integrated terminal — call out explicitly).

**Acceptance**:
- All files exist.
- `configuration-guide.md` explicitly documents the FR-5 precedence (flag > .env > shell env) and the no-fallback rule.
- README troubleshooting covers: sox-not-found, mic-permission-denied, invalid-key, network-unreachable.

**Verification commands**:
```bash
ls docs/design/project-design.md docs/design/project-functions.md docs/design/configuration-guide.md README.md
```

**Depends on**: Phase 2 (interfaces define what to document).

---

### Phase 4 — Test Harness

**Deliverable**: Vitest configured and a single passing sanity test, plus `test_scripts/` shell scripts for the CLI-level integration tests required by AC-14.

**Files to create**:
- `vitest.config.ts` — point at `src/**/*.test.ts`, Node environment.
- `src/sanity.test.ts` — trivial `expect(true).toBe(true)`.
- `test_scripts/README.md` — explains the manual + automated split.
- `test_scripts/test-help.sh` — runs `node dist/index.js --help`, asserts every flag is mentioned and exit code 0 (AC-2).
- `test_scripts/test-version.sh` — runs `node dist/index.js --version`, asserts output matches `package.json` `version` and exit code 0 (AC-3).
- `test_scripts/test-missing-key.sh` — unsets `SONIOX_API_KEY`, runs the CLI, asserts non-zero exit and `MissingConfigurationError` on stderr (AC-4).

**Acceptance**:
- `pnpm test` runs `src/sanity.test.ts` and exits 0.
- The three shell scripts under `test_scripts/` are executable (`chmod +x`).

**Verification commands**:
```bash
pnpm test
chmod +x test_scripts/*.sh
```

**Depends on**: Phase 2.

---

### Phase 5 — Parallel Implementation (Units A–D), then Sequential Orchestrator (Unit E)

This is the core build phase. **Units A, B, C, D can be implemented in parallel** because their public surfaces are frozen by Phase 2's interfaces. **Unit E is sequenced last** because it composes the others.

#### Unit A — Config & CLI entry (`src/config.ts`)

**Responsibility**: argv parsing via Commander; `.env` loading via `process.loadEnvFile()`; API-key resolution chain (flag > `.env` > shell env); construct `ResolvedConfig` or throw `MissingConfigurationError`.

**Flags to implement**:
- `--api-key <value>` — Soniox API key (overrides env/file).
- `--language <code>` — language hint, default `en`. Accepts `auto`.
- `--output-mode <mode>` — choices `overwrite|append|final-only`, default `overwrite`.
- `--verbose, -v` — boolean, default false.
- `--help, -h` — Commander built-in.
- `--version, -V` — Commander `.version()` pulling from `package.json`.

**Resolution sequence**:
1. Parse argv with Commander.
2. If `opts.apiKey` truthy → use it. Skip env loading.
3. Else try `process.loadEnvFile(path.resolve(process.cwd(), '.env'))` inside `try`/`catch` (catch is for "file does not exist" — re-throw any other error).
4. Read `process.env.SONIOX_API_KEY`. If present → use it.
5. Else → `throw new MissingConfigurationError("SONIOX_API_KEY is not set. Provide it via --api-key <key>, a .env file in the working directory, or the SONIOX_API_KEY environment variable.")`.

**Help text MUST**: list every flag with a one-line description and include at least one usage example (satisfies AC-2).

**Acceptance**:
- `mic-tool-ts --help` lists all flags + at least one example, exit 0 (AC-2).
- `mic-tool-ts --version` prints `package.json` version, exit 0 (AC-3).
- Missing-key path throws `MissingConfigurationError`, the orchestrator exits non-zero with the message on stderr (AC-4).
- Precedence test: with shell `SONIOX_API_KEY=A`, `.env` `SONIOX_API_KEY=B`, and `--api-key C`, the resolved key is `C`. Without `--api-key`, resolved is `B` (AC-7).

**Verification commands**: `test_scripts/test-help.sh`, `test_scripts/test-version.sh`, `test_scripts/test-missing-key.sh`.

**Depends on**: Phase 2 (errors, types).

---

#### Unit B — Mic source (`src/mic/soxMicSource.ts`, `src/mic/index.ts`)

**Responsibility**: macOS implementation of `MicSource` that spawns `sox`; expose `Readable<Buffer>`; map subprocess errors to `MicBackendUnavailableError` / `MicPermissionError`; provide a `NotImplementedError` stub for Linux/Windows behind the same factory (NFR-6).

**Spawn command** (locked):
```ts
spawn("sox", [
  "-q", "-d",
  "-t", "raw", "-r", "16000", "-c", "1", "-b", "16",
  "-e", "signed-integer", "-L", "-",
], { stdio: ["ignore", "pipe", "pipe"] });
```

**Error mapping**:
- `ENOENT` from spawn → `MicBackendUnavailableError("sox is not installed. Run: brew install sox")`.
- Process exits with non-zero code AND stderr matches `/permission|not authorized|coreaudio/i` → `MicPermissionError("Microphone access denied. Grant access in System Settings → Privacy & Security → Microphone, then re-run.")` (AC-9).
- Other non-zero exit → generic `MicToolError("sox exited with code N: <stderr tail>")`.

**stderr handling**: buffer last 256 bytes for error diagnostics; only forward to `process.stderr` when verbose mode is enabled (verbose flag passed via constructor argument or readonly property — keep MicSource itself verbose-aware to avoid leaking sox progress noise into stdout pipelines).

**Factory** (`src/mic/index.ts`):
```ts
export function createMicSource(opts: { verbose: boolean }): MicSource {
  if (process.platform === "darwin") return new SoxMicSource(opts);
  throw new NotImplementedError(`Mic capture for platform '${process.platform}' is not implemented in v1. Only macOS (darwin) is supported.`);
}
```

**Acceptance**:
- On a Mac with sox installed and mic permission granted, `start()` resolves and `audio` emits `Buffer` chunks containing PCM data.
- Without sox: `start()` rejects with `MicBackendUnavailableError`.
- With mic permission denied: `start()` rejects with `MicPermissionError` (AC-9).
- `stop()` is idempotent and resolves once the child has exited.

**Verification commands**:
```bash
pnpm tsc --noEmit
# Manual smoke: a small test script that runs SoxMicSource for 2 seconds and writes audio to a .raw file,
# then plays it back with: play -t raw -r 16000 -c 1 -b 16 -e signed-integer -L file.raw
```

**Depends on**: Phase 2 (`MicSource` interface, error classes).

---

#### Unit C — Soniox client wrapper (`src/soniox/client.ts`)

**Responsibility**: thin adapter around `@soniox/node`'s `SonioxNodeClient` + `RealtimeSttSession`. Build the session config (translating `--language` into `language_hints`/`enable_language_identification`); wire all required events; expose the typed `Transcriber` interface; map Soniox error classes to the CLI's error taxonomy; implement the bounded-timeout shutdown sequence.

**Language flag mapping**:
```ts
const languageOpts = cfg.language === "auto"
  ? { enable_language_identification: true }
  : { language_hints: [cfg.language] };
```

**Session config** (locked from research, section 2):
```ts
{
  model: "stt-rt-v4",
  audio_format: "pcm_s16le",
  sample_rate: 16000,
  num_channels: 1,
  enable_endpoint_detection: true,
  max_endpoint_delay_ms: 2000,
  ...languageOpts,
}
```

**`start(events)` flow**:
1. `client = new SonioxNodeClient({ api_key: cfg.apiKey })`.
2. `session = client.realtime.stt(sessionConfig)`.
3. Wire events **before** connecting:
   - `'result'` → filter `<end>`/`<fin>`, classify tokens by `is_final`, call `events.onTokens(tokenViews)`.
   - `'endpoint'` → `events.onEndpoint()`.
   - `'error'` → map via `mapSonioxError(err)` (see below) → `events.onError(mapped)`.
   - `'disconnected'` → `events.onClose()`.
4. `await session.connect()` inside a `try/catch`. **Catch both thrown errors AND any `'error'` event that fires during the connect window** — per research §5 the SDK delivers errors via two channels. Use a one-shot `'error'` listener registered before `connect()` and remove it on success; if it fires before `connect()` resolves, treat as a connect-time failure.
5. On `AuthError` → throw `AuthenticationError("Soniox rejected the API key. Verify SONIOX_API_KEY is correct.")` (AC-11).
6. On `ConnectionError` / `NetworkError` thrown from `connect()` → throw `ConnectionError("Could not reach Soniox: <message>")` (AC-10).

**`pushAudio(chunk)` flow**: guard `session.state === "connected"` (per research §8); if so, `session.sendAudio(chunk)`. Otherwise drop silently — the orchestrator will already be shutting down.

**`stop()` flow** (per research §5 graceful shutdown):
```ts
if (session.state !== "connected") { session.close(); return; }
session.finalize();
try {
  await Promise.race([
    session.finish(),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error("shutdown timeout")), 1500)),
  ]);
} catch {
  session.close();
}
```

**Error mapper** (`mapSonioxError`):
- `AuthError` → `AuthenticationError`.
- `ConnectionError` (pre-connect) → `ConnectionError`.
- `NetworkError` / `ConnectionError` (post-connect, mid-stream) → `StreamDisconnectedError("Soniox session dropped: <message>. v1 does not auto-reconnect; re-run mic-tool-ts to start a new session.")`.
- `BadRequestError`, `QuotaError`, `StateError`, anything else → re-wrap in a generic `MicToolError`.

**Acceptance**:
- Successful AC-5 end-to-end: a valid key + spoken sentence → final transcript line within 2 s of phrase end.
- AC-6: partial tokens flow before finals.
- AC-10: blocked endpoint → `ConnectionError`, clean non-zero exit, no hang. With `connect_timeout_ms: 5000` overridden for faster test failure if needed.
- AC-11: invalid key → `AuthenticationError`, clean non-zero exit.
- Mid-stream WS drop → `StreamDisconnectedError`, clean non-zero exit (fail-fast policy).

**Verification commands**:
```bash
pnpm tsc --noEmit
# Unit test: mock @soniox/node and assert AuthError mapping and shutdown-timeout behavior.
```

**Depends on**: Phase 2 (error classes, contracts).

---

#### Unit D — Renderer (`src/render/renderer.ts`)

**Responsibility**: three stdout rendering modes; filter `<end>` / `<fin>` markers; never emit non-transcript text to stdout.

**Modes**:

- **`overwrite` (default)** — Maintain a `committedText` string (joined text of all final tokens received in the current utterance, marker-filtered). On each `onTokens(tokens)`:
  1. Append finals (non-marker) to `committedText`.
  2. Build the visible line as `committedText + partialsJoined`, where `partialsJoined` is `tokens.filter(!isFinal).map(t=>t.text).join("")`.
  3. `stdout.write("\r" + visibleLine + " ".repeat(padLen))` where `padLen` is enough to overwrite any trailing characters from the previous partial.
  On `onEndpoint()`: `stdout.write("\r" + committedText.trim() + "\n")`, then `committedText = ""`. On `flush()`: same as endpoint, used at shutdown.

- **`append`** — On each `onTokens(tokens)`: for every non-marker token (final OR partial), `stdout.write(token.text + "\n")`. No carriage returns. (Pipe-friendly; satisfies AC-12 part 1.) `onEndpoint()` and `flush()` are no-ops.

- **`final-only`** — Maintain `committedText` as in overwrite. Do NOT render partials. On `onEndpoint()`: write the committed line + `\n`, reset. On `flush()`: same. (Cleanest pipe output; satisfies AC-12 part 2.)

**Marker filter** (applied in all modes):
```ts
const isMarker = (t: { text: string }) => t.text === "<end>" || t.text === "<fin>";
```

**Acceptance**:
- AC-6: in `overwrite` mode, partials visibly update the current line.
- AC-12: in `append` and `final-only` modes, `mic-tool-ts > transcript.txt` produces a file with no `\r` characters and no ANSI noise.
- `<end>` and `<fin>` never appear in output in any mode.

**Verification commands**:
```bash
pnpm tsc --noEmit
# Unit test (Vitest): feed canned token sequences into each renderer, capture stdout via a mock WriteStream, assert exact byte output.
```

**Depends on**: Phase 2 (no SDK types — `Renderer` only sees the simplified `{text, isFinal}` shape).

---

#### Unit E — Orchestrator (`src/main.ts`, `src/index.ts`)

**Responsibility**: wire Units A+B+C+D together; install SIGINT/SIGTERM handlers; own the top-level try/catch for error rendering and exit-code selection.

**`src/index.ts`**:
```ts
#!/usr/bin/env node
import { main } from "./main.js";
main(process.argv).then(code => process.exit(code)).catch(err => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(99);  // unexpected
});
```

**`src/main.ts` — `main(argv)` flow**:
1. `cfg = await resolveConfig(argv)` — may throw `MissingConfigurationError`.
2. `mic = createMicSource({ verbose: cfg.verbose })` — may throw `NotImplementedError` on non-macOS.
3. `transcriber = createTranscriber({ apiKey: cfg.apiKey, language: cfg.language, verbose: cfg.verbose })`.
4. `renderer = createRenderer(cfg.outputMode, process.stdout)`.
5. Define `shutdown(exitCode: number)` (idempotent flag-guarded):
   - log "Shutting down..." to stderr.
   - `await mic.stop()`.
   - `await transcriber.stop()` (bounded by its own 1.5 s timeout).
   - `renderer.flush()`.
   - resolve `main` with `exitCode`.
6. `process.once("SIGINT", () => shutdown(0))` and `process.once("SIGTERM", () => shutdown(0))`.
7. `await transcriber.start({ onTokens, onEndpoint, onError, onClose })` — wire to `renderer`. On `onError`: log error message to stderr and `shutdown(err.exitCode)`. On `onClose`: if shutdown not already initiated, `shutdown(7)` (StreamDisconnectedError exit code).
8. `await mic.start()`.
9. `if (cfg.verbose) process.stderr.write("Connected. Listening on default mic. Press Ctrl+C to stop.\n")`.
10. Pipe `mic.audio` → `transcriber.pushAudio`: `mic.audio.on("data", (chunk) => transcriber.pushAudio(chunk))`.
11. Return a promise that resolves when `shutdown` is invoked.

**Error rendering at top level**:
- `MissingConfigurationError` → write `err.message` to stderr, exit `err.exitCode` (2).
- `MicBackendUnavailableError` → write `err.message` (includes brew install hint) to stderr, exit 3.
- `MicPermissionError` → write `err.message` to stderr, exit 4.
- `AuthenticationError` → exit 5.
- `ConnectionError` → exit 6.
- `StreamDisconnectedError` → exit 7.
- `NotImplementedError` → exit 50.
- Any unexpected error → exit 99.

**Acceptance**:
- AC-1: `pnpm build` produces a working `dist/index.js`; `node dist/index.js --help` works.
- AC-8: Ctrl+C during active session → shutdown message on stderr, pending finals flushed to stdout, WS closed cleanly, exit 0 within 1.5 s of the signal.
- All other ACs satisfied by the unit contracts above.

**Verification commands**:
```bash
pnpm build
node dist/index.js --help
node dist/index.js --version
```

**Depends on**: Units A, B, C, D.

---

### Phase 6 — Integration Tests (AC-14)

**Deliverable**: Vitest integration tests for the no-network paths.

**Files to create**:
- `src/main.test.ts` — drive `main(argv)` with mocked `MicSource` (emits a canned audio buffer) and mocked `Transcriber` (emits canned token sequences). Cover:
  - Missing-key path exits 2 with `MissingConfigurationError` on stderr (AC-4).
  - Help path exits 0 with all flags listed (AC-2).
  - Version path exits 0 (AC-3).
  - Precedence: flag > .env > shell env (AC-7) — set `process.env`, write a temp `.env`, run.
  - Shutdown: simulate SIGINT, assert order: mic.stop → transcriber.stop → renderer.flush → exit 0 (AC-8 logic).
- `src/render/renderer.test.ts` — feed canned token sequences into each of the three renderers and assert exact stdout byte sequences. Cover marker filtering.

**Acceptance**:
- `pnpm test` passes all tests.
- Coverage includes AC-2, AC-3, AC-4, AC-7, AC-8 logic, AC-12 (renderer byte assertions).

**Verification commands**:
```bash
pnpm test
```

**Depends on**: Phase 5.

---

### Phase 7 — Build & Audit Gate

**Deliverable**: Production build, final audit, lint clean.

**Verification commands**:
```bash
pnpm tsc --noEmit
pnpm build
pnpm audit                  # MUST report 0 HIGH+ advisories (AC-1)
pnpm lint                   # if eslint is wired
chmod +x dist/index.js
node dist/index.js --help   # smoke
```

**Acceptance**:
- All commands exit 0.
- `pnpm audit` shows 0 HIGH-or-above advisories.
- `dist/index.js` is executable.

**Depends on**: Phase 6.

---

### Phase 8 — Documentation Finalization

**Deliverable**: Sync all docs with the as-built implementation.

**Tasks**:
- Update `docs/design/project-design.md` with the final module map, sequence diagram, and any deviations from this plan.
- Confirm `docs/design/configuration-guide.md` matches `Unit A` precedence implementation exactly.
- Update `README.md` Examples section with copy-pasteable invocations.
- Verify `docs/design/project-functions.md` still matches the implementation; flag any FR drift.
- Sweep `Issues - Pending Items.md`: every dep listed has a vetted-on date; pending items left over are clearly marked.

**Acceptance**: AC-13 (docs present and consistent).

**Verification commands**: manual review checklist in `docs/design/project-design.md`.

**Depends on**: Phase 7.

---

### Phase 9 — Manual End-to-End Acceptance (Mic Required)

**Deliverable**: Human-run validation of every AC that requires a mic + Soniox account + macOS.

**Test runs** (each must pass):
1. **AC-5 (live transcription)** — speak "the quick brown fox jumps over the lazy dog" into the default mic; verify a finalized matching line appears on stdout within 2 s.
2. **AC-6 (partials render live)** — speak a long sentence slowly; verify partial text updates on the current console line (in `overwrite` mode).
3. **AC-7 (precedence)** — run with shell `SONIOX_API_KEY=invalidA`, `.env` `SONIOX_API_KEY=validB`, `--api-key validC` → must connect with `validC`. Repeat without `--api-key` → must connect with `validB`.
4. **AC-8 (graceful Ctrl+C)** — start session, speak, Ctrl+C mid-sentence; verify shutdown message on stderr, pending finals flushed, clean exit 0 in <1.5 s.
5. **AC-9 (mic permission)** — revoke mic permission for the terminal app in System Settings; run; verify `MicPermissionError` with remediation message, non-zero exit.
6. **AC-10 (network failure)** — add `127.0.0.1 stt-rt.soniox.com` to `/etc/hosts`; run; verify `ConnectionError`, non-zero exit, no hang.
7. **AC-11 (invalid key)** — run with a syntactically valid but rejected key; verify `AuthenticationError`, non-zero exit.
8. **AC-12 (pipe-friendly)** — `node dist/index.js --output-mode append > transcript.txt` and `--output-mode final-only > transcript.txt`; verify file contains transcript text only, no `\r`.

**Acceptance**: every test above passes; results logged in a new `docs/design/acceptance-run-001.md` (date, tester, pass/fail per AC).

**Depends on**: Phase 8.

---

## Dependency Graph

```
Phase 1 (Scaffold)
   |
Phase 2 (Skeleton & Interfaces) ────────────────────┐
   |                                                 |
   +─> Phase 3 (Docs stubs)                         |
   +─> Phase 4 (Test harness)                       |
   |                                                 |
   └─> Phase 5 implementation:                      |
         Unit A (Config) ───────┐                   |
         Unit B (Mic)    ───────┤                   |
         Unit C (Soniox) ───────┤  (A,B,C,D parallel)
         Unit D (Render) ───────┤                   |
                               └─> Unit E (Main) ────┘
                                       |
                                Phase 6 (Integration tests)
                                       |
                                Phase 7 (Build & audit gate)
                                       |
                                Phase 8 (Docs finalization)
                                       |
                                Phase 9 (Manual E2E)
```

| Phase / Unit | Depends on |
|---|---|
| 1 Scaffold | — |
| 2 Skeleton | 1 |
| 3 Docs stubs | 2 |
| 4 Test harness | 2 |
| 5-A Config | 2 |
| 5-B Mic | 2 |
| 5-C Soniox | 2 |
| 5-D Render | 2 |
| 5-E Orchestrator | 5-A, 5-B, 5-C, 5-D |
| 6 Integration tests | 5-E |
| 7 Build & audit | 6 |
| 8 Docs final | 7 |
| 9 Manual E2E | 8 |

**Parallelizable**: Phases 3 and 4 (after Phase 2). Units A, B, C, D within Phase 5.

---

## File Structure (Prescribed)

```
mic-tool-ts/
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vitest.config.ts
├── .gitignore
├── .env.example
├── README.md
├── Issues - Pending Items.md
├── CLAUDE.md                         (already exists)
├── src/
│   ├── index.ts                      # bin entry; calls main()
│   ├── main.ts                       # Unit E orchestrator
│   ├── config.ts                     # Unit A
│   ├── errors.ts                     # shared error taxonomy
│   ├── mic/
│   │   ├── types.ts                  # MicSource interface
│   │   ├── soxMicSource.ts           # Unit B macOS impl
│   │   └── index.ts                  # createMicSource() factory
│   ├── soniox/
│   │   └── client.ts                 # Unit C
│   ├── render/
│   │   └── renderer.ts               # Unit D
│   ├── sanity.test.ts                # Vitest sanity
│   ├── main.test.ts                  # integration tests (mocked deps)
│   └── render/renderer.test.ts       # renderer unit tests
├── dist/                             # build output (gitignored)
├── test_scripts/
│   ├── README.md
│   ├── test-help.sh
│   ├── test-version.sh
│   └── test-missing-key.sh
├── docs/
│   ├── design/
│   │   ├── refined-request-soniox-mic-transcriber.md  (exists)
│   │   ├── plan-001-soniox-mic-cli.md                 (this file)
│   │   ├── project-design.md
│   │   ├── project-functions.md                       (created with this plan)
│   │   ├── configuration-guide.md
│   │   └── acceptance-run-001.md                      (created in Phase 9)
│   ├── reference/
│   │   └── investigation-soniox-mic-cli.md            (exists)
│   └── research/
│       └── soniox-node-sdk-v2.md                      (exists)
└── prompts/                          (exists, empty)
```

---

## Interface Contracts Between Units (Summary)

These are reproduced from Phase 2 above for quick reference; they are the contracts that allow Units A–D to be coded in parallel.

| Producer | Consumer | Contract |
|---|---|---|
| Unit A → Unit E | `resolveConfig(argv): Promise<ResolvedConfig>` from `src/config.ts` |
| Unit B → Unit E | `createMicSource(opts): MicSource` from `src/mic/index.ts`, where `MicSource` is `{ start(): Promise<void>; readonly audio: Readable; stop(): Promise<void> }` |
| Unit C → Unit E | `createTranscriber(cfg): Transcriber` from `src/soniox/client.ts`, where `Transcriber` is `{ start(events: TranscriberEvents): Promise<void>; pushAudio(chunk: Buffer): void; stop(): Promise<void> }` |
| Unit D → Unit E | `createRenderer(mode, stdout): Renderer` from `src/render/renderer.ts`, where `Renderer` is `{ onTokens(tokens): void; onEndpoint(): void; flush(): void }` |
| Unit A → all | All error classes from `src/errors.ts` |

---

## Risks and Mitigations

| # | Risk | Mitigation |
|---|---|---|
| R-1 | User does not have `sox` installed. | Detect `ENOENT` from spawn → throw `MicBackendUnavailableError` with exact message: "sox is not installed. Run: brew install sox". README and `configuration-guide.md` list this as the #1 prerequisite. |
| R-2 | macOS mic permission denied. | Detect non-zero sox exit + stderr matching `/permission|not authorized|coreaudio/i` → throw `MicPermissionError` with System-Settings remediation path. README troubleshooting section covers it (AC-9). |
| R-3 | Soniox `AuthError` may arrive via thrown-from-`connect()` OR via `'error'` event (per research §5 open question 1). | Register a one-shot `'error'` listener BEFORE calling `connect()`, plus wrap `connect()` in try/catch. If either channel fires, classify and throw `AuthenticationError`. Always attach an `'error'` listener before connect to avoid uncaught-exception crashes (per research §5). |
| R-4 | `session.finish()` may deadlock if the WS is already closed (per research §5 open question 2). | Wrap `finish()` in a `Promise.race` against a 1.5 s timeout; on timeout, fall back to `session.close()`. Also guard with `session.state === "connected"` before calling `finalize()`/`finish()` at all. |
| R-5 | `\r` overwrite behavior varies between terminals (iTerm, Terminal.app, VS Code integrated terminal). | Document in README: VS Code integrated terminal can render `\r` as a newline in some configurations; recommend iTerm2 or Terminal.app for `overwrite` mode; recommend `append` or `final-only` for any pipeline / non-TTY use. |
| R-6 | sox stderr noise pollutes stderr. | Buffer sox stderr in `SoxMicSource`; only forward to `process.stderr` when `--verbose` is set. Default behavior keeps stderr clean for the orchestrator's own diagnostics. |
| R-7 | Sending audio to a not-yet-connected (or already-closed) session throws `StateError`. | `Transcriber.pushAudio()` guards `session.state === "connected"` and silently drops otherwise (per research §8). |
| R-8 | Soniox SDK v2 declares a `connect_timeout_ms` default of 20 s — AC-10 test may hang for that long. | Pass `connect_timeout_ms: 5000` in `SttSessionOptions` (still well within healthy-network round-trip allowance); document the override in `configuration-guide.md`. |
| R-9 | Mid-stream WS drop must fail fast (v1 decision). | `mapSonioxError` maps post-connect `NetworkError`/`ConnectionError` to `StreamDisconnectedError` (exit 7). Orchestrator initiates shutdown on `onError`. Documented in README troubleshooting. |
| R-10 | Mixing partial+final tokens in a single result event could cause display jitter. | Renderer accumulates committed-finals into a buffer; partials are appended (not replaced) on the current line; on `'endpoint'`, the buffer flushes to a new line and resets. Specified in Unit D's algorithm. |
| R-11 | npm audit may flag a transitive HIGH in `tsx`/`vitest`/`esbuild`. | Phase 1 acceptance gate requires `pnpm audit` clean; use `pnpm.overrides` per CLAUDE.md and log the override expiry in `Issues - Pending Items.md`. |

---

## Acceptance Criteria → Phase / Unit Mapping

| AC | What it verifies | Owned by |
|---|---|---|
| AC-1 Builds clean, zero HIGH+ advisories | `pnpm install` + `pnpm build` clean, audit clean | Phases 1, 7 |
| AC-2 `--help` lists all flags + example, exit 0 | Commander help block | Unit A; verified by `test_scripts/test-help.sh` (Phase 4) |
| AC-3 `--version` prints `package.json` semver, exit 0 | Commander `.version()` | Unit A; `test_scripts/test-version.sh` |
| AC-4 Missing-key error, clean stderr message, non-zero exit | `MissingConfigurationError` from resolveConfig | Unit A + Unit E top-level catch; `test_scripts/test-missing-key.sh` |
| AC-5 Live transcription within 2 s | End-to-end mic → Soniox → renderer | Units B + C + D + E together; Phase 9 manual run |
| AC-6 Partials render live | Renderer `overwrite` mode | Unit D; Phase 9 |
| AC-7 Precedence flag > .env > shell env | Resolution chain | Unit A; `src/main.test.ts` (Phase 6) + Phase 9 |
| AC-8 Graceful Ctrl+C, exit 0 in <1.5 s | Shutdown sequence | Unit E orchestrator + Unit C `stop()` timeout; Phase 9 |
| AC-9 Mic-permission error with remediation | Sox stderr classification | Unit B; Phase 9 |
| AC-10 Network failure → clear error, no hang | Pre-connect ConnectionError + `connect_timeout_ms: 5000` | Unit C; Phase 9 |
| AC-11 Invalid key → AuthenticationError | AuthError mapping | Unit C; Phase 9 |
| AC-12 Pipe-friendly stdout in append/final-only | Renderer modes | Unit D; Phase 6 byte-level test + Phase 9 |
| AC-13 Docs present | `project-design.md`, `project-functions.md`, `configuration-guide.md`, README | Phase 3 + Phase 8 |
| AC-14 Test scripts cover no-network ACs | `test_scripts/*` + `src/main.test.ts` | Phase 4 + Phase 6 |

---

## Verification Cheat Sheet (Commands)

```bash
# Type check
pnpm tsc --noEmit

# Build
pnpm build

# Unit + integration tests (no mic, no network)
pnpm test

# Audit
pnpm audit

# CLI smoke tests (no network)
test_scripts/test-help.sh
test_scripts/test-version.sh
test_scripts/test-missing-key.sh

# Manual mic test (requires sox + mic permission + valid SONIOX_API_KEY)
SONIOX_API_KEY=sk-... node dist/index.js --language en
```

---

## Out-of-Scope (v1, will not be built by this plan)
- Linux/Windows mic backends (interface stubbed only).
- Device enumeration / `--device` selection.
- Speaker diarization, custom vocabulary, translation.
- Auto-reconnect on WS drop (explicit v1 decision: fail fast).
- TTY output coloring, progress bars, TUI.
- `--keepalive-interval-ms` flag (SDK default is correct for v1).
- Periodic `total_audio_proc_ms` logging under verbose (mentioned in research as nice-to-have; defer unless requested).


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
