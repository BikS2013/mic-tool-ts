import { createWriteStream } from "node:fs";
import type { Writable } from "node:stream";

import {
  HelpOrVersionShown,
  resolveConfig,
  type ResolvedConfig,
} from "../config.js";
import { warnAboutExpiry } from "../config/expiry.js";
import { MicToolError } from "../errors.js";
import { createRefiner } from "../llm/factory.js";
import type { LLMRefiner } from "../llm/types.js";
import { createMicSource } from "../mic/index.js";
import type { MicSource } from "../mic/types.js";
import { VoiceAgentProtocolController } from "../protocol/controller.js";
import { JsonlProtocolWriter } from "../protocol/jsonlWriter.js";
import {
  applyPersistedProtocolSettings,
  loadPersistedProtocolSettings,
  savePersistedProtocolSettings,
} from "../protocol/settingsStore.js";
import type {
  ProtocolEvent,
  ProtocolRuntimeConfig,
  ProtocolWriter,
} from "../protocol/types.js";
import { StdoutRenderer, type Renderer } from "../render/renderer.js";
import { UiRenderer } from "../render/uiRenderer.js";
import { createTranscriber } from "../transcription/factory.js";
import {
  safeConfigSummary,
  type SessionEvent,
  type SessionEventSink,
} from "./sessionEvents.js";

type TtyWritable = NodeJS.WritableStream & Partial<Writable> & { isTTY?: boolean };

const TRANSLATION_SYSTEM_PROMPT =
  "You are a translation assistant for live dictated agent commands. Translate the user's text to the requested target language. Preserve technical terms, filenames, command names, and code identifiers. Respond with ONLY the translated text — no preamble, no quotes, no markdown, no explanation.";
const TOOL_NAME = "mic-tool-ts";
const READY_MESSAGE =
  "[mic-tool-ts] Ready to listen. Press Control-C to stop the listening tool.";

export interface RunMicSessionOptions {
  readonly frontend?: "cli" | "ui";
  readonly stdout?: TtyWritable;
  readonly stderr?: NodeJS.WritableStream;
  readonly handleProcessSignals?: boolean;
  readonly abortSignal?: AbortSignal;
  readonly onEvent?: SessionEventSink;
}

export async function runMicSession(
  argv: string[],
  opts: RunMicSessionOptions = {},
): Promise<number> {
  const frontend = opts.frontend ?? "cli";
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;
  const handleProcessSignals = opts.handleProcessSignals ?? frontend === "cli";
  const emit = opts.onEvent ?? (() => {});
  const writeDiagnostic = (message: string, warning = false): void => {
    if (frontend === "cli") {
      stderr.write(message.endsWith("\n") ? message : `${message}\n`);
    }
    emit({
      type: warning ? "diagnostic.warning" : "diagnostic.info",
      message: message.trimEnd(),
    });
  };

  emit({ type: "session.state", state: "starting" });

  let config: ResolvedConfig;
  try {
    config = resolveConfig(argv);
  } catch (err) {
    if (err instanceof HelpOrVersionShown) return 0;
    return handleTopLevelError(err, stderr, emit, frontend);
  }

  emit({ type: "config.loaded", config: safeConfigSummary(config) });

  warnAboutExpiry(
    {
      envName: config.apiKeyEnvName,
      isoDate: config.apiKeyExpiresAt,
      renewUrl: config.sttProvider === "soniox"
        ? "https://console.soniox.com"
        : "https://elevenlabs.io/app/settings/api-keys",
      verbose: config.verbose,
    },
    false,
    (line) => writeDiagnostic(line, line.includes("WARNING")),
  );

  if (config.verbose) {
    writeDiagnostic(
      `[mic-tool-ts] config: sttProvider=${config.sttProvider}, outputMode=${config.outputMode}, languages=[${config.languages.join(", ")}], verbose=true`,
    );
    writeDiagnostic(`[mic-tool-ts] platform=${process.platform}, node=${process.version}`);
  }

  let protocolConfig: ProtocolRuntimeConfig;
  try {
    const persisted = loadPersistedProtocolSettings({ toolName: TOOL_NAME });
    protocolConfig = applyPersistedProtocolSettings(config.protocol, persisted);
    if (config.verbose && persisted !== null) {
      writeDiagnostic(
        `[mic-tool-ts] restored protocol settings: refine=${protocolConfig.initialOperators.refine ? "on" : "off"}, translate=${protocolConfig.initialOperators.translate ? "on" : "off"}, clipboard=${protocolConfig.initialOperators.clipboard ? "on" : "off"}, input=${protocolConfig.initialOperators.input ? "on" : "off"}, translation_policy=${protocolConfig.translationPolicy}`,
      );
    }
  } catch (err) {
    return handleTopLevelError(err, stderr, emit, frontend);
  }

  const baseRenderer = createRenderer({
    frontend,
    mode: config.outputMode,
    stdout,
    emit,
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
    try {
      refiner?.dispose();
      baseRenderer.dispose();
    } catch {
      /* best effort */
    }
    return handleTopLevelError(err, stderr, emit, frontend);
  }

  const protocolWriter = createProtocolWriter(protocolConfig, frontend, stdout, emit);
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
    diagnosticWriter: (line, warning) => writeDiagnostic(line, warning),
  });
  renderer.startSession();

  let asyncError: Error | null = null;
  let shuttingDown = false;
  let shutdownDone = false;
  let transcriberStarted = false;
  let micStarted = false;
  let mic: MicSource | undefined;
  let shutdownResolve: (() => void) | undefined;
  const shutdownPromise = new Promise<void>((resolve) => {
    shutdownResolve = resolve;
  });

  const recordAsyncError = (err: unknown): void => {
    if (asyncError !== null) return;
    asyncError = err instanceof Error ? err : new Error(String(err));
  };

  const shutdown = (reason: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    emit({ type: "session.state", state: "stopping", reason });
    if (config.verbose) {
      writeDiagnostic(`[mic-tool-ts] shutting down: ${reason}`);
    }
    void (async () => {
      if (micStarted && mic !== undefined) {
        try {
          await mic.stop();
        } catch (err) {
          if (config.verbose) {
            writeDiagnostic(
              `[mic-tool-ts] mic.stop() error: ${err instanceof Error ? err.message : String(err)}`,
              true,
            );
          }
          recordAsyncError(err);
        }
      }
      if (transcriberStarted) {
        try {
          await transcriber.stop();
        } catch (err) {
          if (config.verbose) {
            writeDiagnostic(
              `[mic-tool-ts] transcriber.stop() error: ${err instanceof Error ? err.message : String(err)}`,
              true,
            );
          }
          recordAsyncError(err);
        }
      }
      try {
        await renderer.endSession(reason);
        persistProtocolSettings(renderer, config.verbose, writeDiagnostic);
        renderer.dispose();
      } catch (err) {
        recordAsyncError(err);
      }
      shutdownDone = true;
      emit({ type: "session.state", state: "stopped", reason });
      shutdownResolve?.();
    })();
  };

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

  try {
    await transcriber.start();
    transcriberStarted = true;
  } catch (err) {
    try {
      await renderer.endSession("startup-error");
      renderer.dispose();
    } catch {
      /* best effort */
    }
    return handleTopLevelError(err, stderr, emit, frontend);
  }

  try {
    mic = createMicSource({
      sampleRate: config.sampleRate,
      verbose: config.verbose,
    });
  } catch (err) {
    try {
      await transcriber.stop();
    } catch {
      /* best effort */
    }
    try {
      await renderer.endSession("startup-error");
      renderer.dispose();
    } catch {
      /* best effort */
    }
    return handleTopLevelError(err, stderr, emit, frontend);
  }

  try {
    await mic.start();
    micStarted = true;
  } catch (err) {
    try {
      await transcriber.stop();
    } catch {
      /* best effort */
    }
    try {
      await renderer.endSession("startup-error");
      renderer.dispose();
    } catch {
      /* best effort */
    }
    return handleTopLevelError(err, stderr, emit, frontend);
  }

  mic.audio.on("data", (chunk: Buffer) => transcriber.pushAudio(chunk));
  mic.audio.on("error", (err: Error) => {
    recordAsyncError(err);
    shutdown("mic-error");
  });
  mic.audio.on("end", () => {
    shutdown("mic-end");
  });

  const onSigint = (): void => {
    if (shuttingDown && !shutdownDone) {
      stderr.write("[mic-tool-ts] force quit\n");
      process.exit(130);
    }
    shutdown("SIGINT");
  };
  const onSigterm = (): void => {
    if (shuttingDown && !shutdownDone) {
      stderr.write("[mic-tool-ts] force quit\n");
      process.exit(143);
    }
    shutdown("SIGTERM");
  };
  const onAbort = (): void => shutdown("ui-stop");

  if (handleProcessSignals) {
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
  }
  opts.abortSignal?.addEventListener("abort", onAbort, { once: true });

  if (opts.abortSignal?.aborted === true) {
    shutdown("ui-stop");
  } else {
    const readyEvent = { type: "session.ready", message: READY_MESSAGE } as const;
    emit(readyEvent);
    emit({ type: "session.state", state: "listening" });
    if (frontend === "cli") {
      stderr.write(`${READY_MESSAGE}\n`);
    }
  }

  try {
    await shutdownPromise;
  } finally {
    if (handleProcessSignals) {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    }
    opts.abortSignal?.removeEventListener("abort", onAbort);
  }

  if (asyncError !== null) {
    return handleTopLevelError(asyncError, stderr, emit, frontend);
  }
  return 0;
}

function createRenderer(opts: {
  frontend: "cli" | "ui";
  mode: ResolvedConfig["outputMode"];
  stdout: TtyWritable;
  emit: SessionEventSink;
}): Renderer {
  if (opts.frontend === "ui") {
    return new UiRenderer(opts.emit);
  }
  return new StdoutRenderer({
    mode: opts.mode,
    isTTY: opts.stdout.isTTY ?? false,
    out: opts.stdout,
  });
}

function createProtocolWriter(
  protocol: ProtocolRuntimeConfig,
  frontend: "cli" | "ui",
  stdout: TtyWritable,
  emit: SessionEventSink,
): ProtocolWriter | undefined {
  if (frontend === "ui") {
    return new EventProtocolWriter(emit);
  }
  if (protocol.interactionMode === "agent-protocol") {
    return new JsonlProtocolWriter({ out: stdout as Writable });
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

class EventProtocolWriter implements ProtocolWriter {
  constructor(private readonly emit: SessionEventSink) {}

  write(event: ProtocolEvent): void {
    this.emit({ type: "protocol.event", event });
  }

  end(): void {
    /* no external resource */
  }
}

function persistProtocolSettings(
  controller: VoiceAgentProtocolController,
  verbose: boolean,
  writeDiagnostic: (message: string, warning?: boolean) => void,
): void {
  try {
    savePersistedProtocolSettings(controller.settingsSnapshot(), {
      toolName: TOOL_NAME,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeDiagnostic(
      `[mic-tool-ts] WARNING: failed to persist protocol settings: ${message}`,
      true,
    );
    if (verbose && err instanceof Error && err.stack !== undefined) {
      writeDiagnostic(err.stack, true);
    }
  }
}

function handleTopLevelError(
  err: unknown,
  stderr: NodeJS.WritableStream,
  emit: SessionEventSink,
  frontend: "cli" | "ui",
): number {
  let code = "UNKNOWN";
  let message: string;
  let exitCode = 1;

  if (err instanceof MicToolError) {
    code = err.code;
    message = err.message;
    exitCode = err.exitCode;
    if (frontend === "cli") {
      stderr.write(`${err.code}: ${err.message}\n`);
    }
  } else if (err instanceof Error) {
    message = err.stack ?? err.message;
    if (frontend === "cli") {
      stderr.write(`${message}\n`);
    }
  } else {
    message = String(err);
    if (frontend === "cli") {
      stderr.write(`${message}\n`);
    }
  }

  emit({ type: "session.state", state: "error" });
  emit({ type: "session.error", code, message, exitCode });
  return exitCode;
}
