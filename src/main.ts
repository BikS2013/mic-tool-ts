/**
 * Unit E — Orchestrator.
 *
 * Composes Units A (config), B (mic), C (STT transcriber) and D (renderer)
 * into a runnable CLI; installs SIGINT/SIGTERM handlers; owns the single
 * top-level try/catch that maps every typed error to an exit code.
 *
 * Public contract: `main(argv): Promise<number>`. NEVER calls `process.exit`
 * directly — the thin shim in `src/index.ts` does that. Keeping `main()`
 * exit-free makes it cheaply testable from Vitest.
 *
 * Sequencing (see docs/design/project-design.md §8 + §9):
 *   1. resolveConfig                       (sync; throws on missing key / help)
 *   2. new StdoutRenderer                  (sync; cannot fail)
 *   3. createTranscriber + wire cbs        (sync)
 *   4. await transcriber.start()           (opens WebSocket; auth-error path)
 *   5. createMicSource() + mic.start()     (spawns sox; permission-error path)
 *   6. wire mic.audio → transcriber.pushAudio
 *   7. install SIGINT/SIGTERM
 *   8. park on the shutdown promise
 *
 * If step 5 fails AFTER step 4 succeeded, we MUST stop the transcriber before
 * returning — otherwise the STT session would stay open until the provider's
 * keepalive timer noticed.
 *
 * Shutdown:
 *   shutdown() is guarded by a boolean so any of:
 *     - SIGINT / SIGTERM,
 *     - transcriber `onError` (mid-stream),
 *     - mic.audio `'error'` event,
 *     - mic.audio `'end'` (clean producer exit),
 *   triggers exactly one teardown pass: mic.stop() → transcriber.stop() →
 *   renderer.dispose(). The first async error captured along the way is
 *   returned via `handleTopLevelError`; otherwise we exit 0.
 *
 *   A second SIGINT during shutdown short-circuits to `process.exit(130)` so
 *   the user can always escape a hung close (matches POSIX 128+SIGINT).
 */

import { createWriteStream } from "node:fs";

import { resolveConfig, HelpOrVersionShown, type ResolvedConfig } from "./config.js";
import { createMicSource } from "./mic/index.js";
import type { MicSource } from "./mic/types.js";
import { createTranscriber } from "./transcription/factory.js";
import { StdoutRenderer } from "./render/renderer.js";
import { createRefiner } from "./llm/factory.js";
import type { LLMRefiner } from "./llm/types.js";
import { warnAboutExpiry } from "./config/expiry.js";
import { MicToolError } from "./errors.js";
import { VoiceAgentProtocolController } from "./protocol/controller.js";
import { JsonlProtocolWriter } from "./protocol/jsonlWriter.js";
import type { ProtocolRuntimeConfig, ProtocolWriter } from "./protocol/types.js";
import {
  applyPersistedProtocolSettings,
  loadPersistedProtocolSettings,
  savePersistedProtocolSettings,
} from "./protocol/settingsStore.js";

const TRANSLATION_SYSTEM_PROMPT =
  "You are a translation assistant for live dictated agent commands. Translate the user's text to the requested target language. Preserve technical terms, filenames, command names, and code identifiers. Respond with ONLY the translated text — no preamble, no quotes, no markdown, no explanation.";
const TOOL_NAME = "mic-tool-ts";

/**
 * Entry point. Returns a numeric exit code; never calls `process.exit`.
 *
 * Exit codes follow the {@link MicToolError} hierarchy:
 *   0 success | 1 unknown | 2 config | 3 mic | 4 auth | 5 network | 6 protocol
 */
export async function main(argv: string[]): Promise<number> {
  // ----- Step 1: resolve config (synchronous; help/version exits early) ----
  let config: ResolvedConfig;
  try {
    config = resolveConfig(argv);
  } catch (err) {
    if (err instanceof HelpOrVersionShown) return 0;
    return handleTopLevelError(err);
  }

  // Operational expiry warning for the active STT provider API key (per CLAUDE.md
  // <configuration-guide> guidance). Non-fatal; user owns renewal.
  warnAboutExpiry({
    envName: config.apiKeyEnvName,
    isoDate: config.apiKeyExpiresAt,
    renewUrl: config.sttProvider === "soniox"
      ? "https://console.soniox.com"
      : "https://elevenlabs.io/app/settings/api-keys",
    verbose: config.verbose,
  });

  if (config.verbose) {
    process.stderr.write(
      `[mic-tool-ts] config: sttProvider=${config.sttProvider}, outputMode=${config.outputMode}, languages=[${config.languages.join(", ")}], verbose=true\n`,
    );
    process.stderr.write(
      `[mic-tool-ts] platform=${process.platform}, node=${process.version}\n`,
    );
  }

  let protocolConfig: ProtocolRuntimeConfig;
  try {
    const persisted = loadPersistedProtocolSettings({ toolName: TOOL_NAME });
    protocolConfig = applyPersistedProtocolSettings(config.protocol, persisted);
    if (config.verbose && persisted !== null) {
      process.stderr.write(
        `[mic-tool-ts] restored protocol settings: refine=${protocolConfig.initialOperators.refine ? "on" : "off"}, translate=${protocolConfig.initialOperators.translate ? "on" : "off"}, clipboard=${protocolConfig.initialOperators.clipboard ? "on" : "off"}, translation_policy=${protocolConfig.translationPolicy}\n`,
      );
    }
  } catch (err) {
    return handleTopLevelError(err);
  }

  // ----- Step 2: build the renderer/protocol stack (sync; cannot fail) ----
  const baseRenderer = new StdoutRenderer({
    mode: config.outputMode,
    isTTY: process.stdout.isTTY ?? false,
  });
  let refiner: LLMRefiner | null = null;
  let translator: LLMRefiner | null = null;
  try {
    refiner = createRefiner(config.llm);
    translator = config.llm.enabled
      ? createRefiner({
          ...config.llm,
          systemPrompt: TRANSLATION_SYSTEM_PROMPT,
        })
      : null;
  } catch (err) {
    // LLMConfigurationError at startup is fatal (exit code 2). Dispose the
    // renderer so the dispose chain stays balanced even though it's a no-op
    // here (we haven't written anything yet).
    try {
      refiner?.dispose();
      baseRenderer.dispose();
    } catch {
      /* best effort */
    }
    return handleTopLevelError(err);
  }
  const protocolWriter = createProtocolWriter(protocolConfig);
  const renderer = new VoiceAgentProtocolController({
    mode: protocolConfig.interactionMode,
    renderer: baseRenderer,
    writer: protocolWriter,
    markers: protocolConfig.markers,
    initialOperators: protocolConfig.initialOperators,
    translationPolicy: protocolConfig.translationPolicy,
    verbose: config.verbose,
    refiner,
    translator,
  });
  renderer.startSession();

  // ----- Shared state for the rest of main() ------------------------------
  let asyncError: Error | null = null;
  let shuttingDown = false;
  let shutdownDone = false;
  let transcriberStarted = false;
  let micStarted = false;
  // `mic` is referenced from inside the `shutdown` closure below, which can
  // fire as soon as `transcriber.onError` is invoked. Declare it here (before
  // the closure) so we can never hit a temporal-dead-zone ReferenceError.
  let mic: MicSource | undefined;
  let shutdownResolve: (() => void) | undefined;
  const shutdownPromise = new Promise<void>((resolve) => {
    shutdownResolve = resolve;
  });

  /**
   * Record an async error (first one wins). Used by every event channel that
   * cannot throw into `main()` directly.
   */
  const recordAsyncError = (err: unknown): void => {
    if (asyncError !== null) return;
    if (err instanceof Error) asyncError = err;
    else asyncError = new Error(String(err));
  };

  /** Idempotent teardown. Resolves the shutdown promise on completion. */
  const shutdown = (reason: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (config.verbose) {
      process.stderr.write(`[mic-tool-ts] shutting down: ${reason}\n`);
    }
    // Run the teardown chain on the microtask queue so the caller's stack
    // (signal handler / event emitter) unwinds first.
    void (async () => {
      // 1. Stop the mic if it ever started.
      if (micStarted && mic !== undefined) {
        try {
          await mic.stop();
        } catch (err) {
          if (config.verbose) {
            process.stderr.write(
              `[mic-tool-ts] mic.stop() error: ${err instanceof Error ? err.message : String(err)}\n`,
            );
          }
          recordAsyncError(err);
        }
      }
      // 2. Stop the transcriber if it ever started. The wrapper's stop() is
      //    safe to call even if start() never resolved, but we still gate to
      //    avoid touching an unfinished SDK session — Unit C's start() owns
      //    pre-connect cleanup.
      if (transcriberStarted) {
        try {
          await transcriber.stop();
        } catch (err) {
          if (config.verbose) {
            process.stderr.write(
              `[mic-tool-ts] transcriber.stop() error: ${err instanceof Error ? err.message : String(err)}\n`,
            );
          }
          recordAsyncError(err);
        }
      }
      // 3. Renderer cleanup — synchronous, must not throw.
      try {
        await renderer.endSession(reason);
        persistProtocolSettings(renderer, config.verbose);
        renderer.dispose();
      } catch (err) {
        recordAsyncError(err);
      }
      shutdownDone = true;
      shutdownResolve?.();
    })();
  };

  // ----- Step 3: build the transcriber and wire its callbacks -------------
  const transcriber = createTranscriber({
    provider: config.sttProvider,
    apiKey: config.apiKey,
    model: config.model,
    endpoint: config.endpoint,
    languages: config.languages,
    sampleRate: config.sampleRate,
    enableEndpointDetection: config.enableEndpointDetection,
    verbose: config.verbose,
  });
  transcriber.onPartial((text) => renderer.partial(text));
  transcriber.onFinal((text) => renderer.final(text));
  transcriber.onError((err) => {
    recordAsyncError(err);
    shutdown("transcriber-error");
  });

  // ----- Step 4: open the STT WebSocket FIRST -----------------------------
  // Doing transcriber.start() before mic.start() means an auth/network
  // failure aborts before we ever ask CoreAudio for the microphone — quicker
  // failure, no spurious mic-permission prompt.
  try {
    await transcriber.start();
    transcriberStarted = true;
  } catch (err) {
    // STT provider refused (auth / network / protocol). Nothing else has started.
    try {
      await renderer.endSession("startup-error");
      renderer.dispose();
    } catch {
      /* best effort */
    }
    return handleTopLevelError(err);
  }

  // ----- Step 5: spawn the mic. ANY failure here MUST also stop the
  //              already-running transcriber so the WS doesn't dangle. ----
  try {
    mic = createMicSource({
      sampleRate: config.sampleRate,
      verbose: config.verbose,
    });
  } catch (err) {
    // Factory failure (UnsupportedPlatformError on non-macOS).
    try {
      await transcriber.stop();
    } catch {
      /* swallow — we already have the primary error */
    }
    try {
      await renderer.endSession("startup-error");
      renderer.dispose();
    } catch {
      /* best effort */
    }
    return handleTopLevelError(err);
  }

  try {
    await mic.start();
    micStarted = true;
  } catch (err) {
    // sox not installed / mic permission denied. Same cleanup as above.
    try {
      await transcriber.stop();
    } catch {
      /* swallow */
    }
    try {
      await renderer.endSession("startup-error");
      renderer.dispose();
    } catch {
      /* best effort */
    }
    return handleTopLevelError(err);
  }

  // ----- Step 6: wire mic → transcriber and watch for mic-side terminals --
  mic.audio.on("data", (chunk: Buffer) => transcriber.pushAudio(chunk));
  mic.audio.on("error", (err: Error) => {
    recordAsyncError(err);
    shutdown("mic-error");
  });
  mic.audio.on("end", () => {
    // Producer ended cleanly. Treat as a normal stop trigger; whether this
    // path occurs in practice depends on the OS — sox normally runs until
    // killed, so this is a defensive trigger only.
    shutdown("mic-end");
  });

  // ----- Step 7: signal handlers ------------------------------------------
  // SIGINT/SIGTERM both trigger graceful shutdown. A second SIGINT during
  // shutdown is treated as "force quit" so the user can always escape.
  const onSigint = (): void => {
    if (shuttingDown && !shutdownDone) {
      // Already shutting down — user is impatient. Exit 130 (SIGINT).
      process.stderr.write("[mic-tool-ts] force quit\n");
      process.exit(130);
    }
    shutdown("SIGINT");
  };
  const onSigterm = (): void => {
    if (shuttingDown && !shutdownDone) {
      process.stderr.write("[mic-tool-ts] force quit\n");
      process.exit(143);
    }
    shutdown("SIGTERM");
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  process.stderr.write(
    "[mic-tool-ts] Ready to listen. Press Control-C to stop the listening tool.\n",
  );

  try {
    // ----- Step 8: park until shutdown completes --------------------------
    await shutdownPromise;
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  }

  // ----- Final disposition ------------------------------------------------
  if (asyncError !== null) {
    return handleTopLevelError(asyncError);
  }
  return 0;
}

/**
 * Map a thrown / captured value to a process exit code and write a single
 * line to stderr describing it.
 *
 * - {@link MicToolError} → `<code>: <message>` and the carried exit code.
 * - Other `Error` → stack (full diagnostic; these are unexpected) and exit 1.
 * - Anything else → coerce via `String()` and exit 1.
 */
function handleTopLevelError(err: unknown): number {
  if (err instanceof MicToolError) {
    process.stderr.write(`${err.code}: ${err.message}\n`);
    return err.exitCode;
  }
  if (err instanceof Error) {
    process.stderr.write(`${err.stack ?? err.message}\n`);
    return 1;
  }
  process.stderr.write(`${String(err)}\n`);
  return 1;
}

function createProtocolWriter(protocol: ProtocolRuntimeConfig): ProtocolWriter | undefined {
  if (protocol.interactionMode === "agent-protocol") {
    return new JsonlProtocolWriter({ out: process.stdout });
  }
  if (protocol.interactionMode === "hybrid") {
    const out = createWriteStream(protocol.protocolOutput as string, {
      flags: "a",
      encoding: "utf8",
    });
    return new JsonlProtocolWriter({ out, closeOnEnd: true });
  }
  return undefined;
}

function persistProtocolSettings(
  controller: VoiceAgentProtocolController,
  verbose: boolean,
): void {
  try {
    savePersistedProtocolSettings(controller.settingsSnapshot(), {
      toolName: TOOL_NAME,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[mic-tool-ts] WARNING: failed to persist protocol settings: ${message}\n`,
    );
    if (verbose && err instanceof Error && err.stack !== undefined) {
      process.stderr.write(`${err.stack}\n`);
    }
  }
}
