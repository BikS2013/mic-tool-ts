/**
 * Unit E tests — Orchestrator (src/main.ts).
 *
 * All external units are mocked:
 *   - src/config.ts        → vi.mock → controlled resolveConfig / HelpOrVersionShown
 *   - src/mic/index.ts     → vi.mock → fake MicSource
 *   - src/transcription/factory.ts → vi.mock → fake transcriber factory
 *   - src/render/renderer.ts → vi.mock → fake StdoutRenderer
 *
 * `main(argv)` is imported and called directly. It must never call
 * `process.exit()` itself — we confirm this by spying on `process.exit`.
 *
 * Signal handlers (SIGINT/SIGTERM) are tested by emitting on `process`
 * directly.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { EventEmitter, PassThrough } from "node:stream";

// --------------------------------------------------------------------------
// Shared fake state — rebuilt fresh before each test via beforeEach.
// --------------------------------------------------------------------------

/**
 * A minimal fake MicSource.
 * `audio` is a PassThrough so we can push data or emit errors from tests.
 */
class FakeMicSource {
  readonly audio = new PassThrough();
  start = vi.fn<() => Promise<void>>(async () => {});
  stop = vi.fn<() => Promise<void>>(async () => {
    if (!this.audio.destroyed) this.audio.push(null);
  });
}

/**
 * A minimal fake provider transcriber.
 * Callback setters are stored so tests can invoke them.
 */
class FakeTranscriber {
  start = vi.fn<() => Promise<void>>(async () => {});
  stop = vi.fn<() => Promise<void>>(async () => {});
  commit = vi.fn<() => Promise<void>>(async () => {});
  pushAudio = vi.fn<(chunk: Buffer) => void>();
  _partialCb?: (text: string) => void;
  _finalCb?: (text: string) => void;
  _errorCb?: (err: Error) => void;
  onPartial = vi.fn((cb: (text: string) => void) => { this._partialCb = cb; });
  onFinal = vi.fn((cb: (text: string) => void) => { this._finalCb = cb; });
  onError = vi.fn((cb: (err: Error) => void) => { this._errorCb = cb; });
}

/** Minimal fake renderer. */
class FakeRenderer {
  partial = vi.fn<(text: string) => void>();
  final = vi.fn<(text: string) => void>();
  turnBoundary = vi.fn<() => void>();
  refined = vi.fn<(text: string) => void>();
  dispose = vi.fn<() => void>();
}

// Module-level references to the current fake instances (reset each test).
let fakeMic: FakeMicSource;
let fakeTranscriber: FakeTranscriber;
let fakeRenderer: FakeRenderer;

// Controls what resolveConfig returns or throws.
let resolveConfigImpl: (argv: string[]) => unknown;
let loadPersistedProtocolSettingsMock: ReturnType<typeof vi.fn>;
let savePersistedProtocolSettingsMock: ReturnType<typeof vi.fn>;

// --------------------------------------------------------------------------
// Mocks
// --------------------------------------------------------------------------

vi.mock("../src/config.js", async () => {
  const actual = await vi.importActual<typeof import("../src/config.js")>(
    "../src/config.js",
  );
  return {
    ...actual,
    resolveConfig: (argv: string[]) => resolveConfigImpl(argv),
  };
});

vi.mock("../src/mic/index.js", () => ({
  createMicSource: () => fakeMic,
}));

vi.mock("../src/transcription/factory.js", () => ({
  createTranscriber: vi.fn(() => fakeTranscriber),
}));

vi.mock("../src/render/renderer.js", () => ({
  StdoutRenderer: class {
    constructor(_opts: unknown) {
      Object.assign(this, fakeRenderer);
    }
    partial(t: string) { fakeRenderer.partial(t); }
    final(t: string) { fakeRenderer.final(t); }
    turnBoundary() { fakeRenderer.turnBoundary(); }
    refined(t: string) { fakeRenderer.refined(t); }
    dispose() { fakeRenderer.dispose(); }
  },
}));

vi.mock("../src/protocol/settingsStore.js", () => ({
  applyPersistedProtocolSettings: (
    protocol: unknown,
    persisted: unknown,
  ) => protocol,
  loadPersistedProtocolSettings: (...args: unknown[]) =>
    loadPersistedProtocolSettingsMock(...args),
  savePersistedProtocolSettings: (...args: unknown[]) =>
    savePersistedProtocolSettingsMock(...args),
}));

// Import main AFTER mocks are set up.
import { main } from "../src/main.js";
import {
  runMicSession,
  type ProtocolFeatureToggleListener,
  type SubmitPendingListener,
} from "../src/core/sessionRunner.js";
import {
  HelpOrVersionShown,
  type ResolvedConfig,
} from "../src/config.js";
import {
  MissingConfigurationError,
  SonioxAuthError,
  SonioxNetworkError,
  MicNotAvailableError,
  MicPermissionDeniedError,
} from "../src/errors.js";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

const GOOD_CONFIG: ResolvedConfig = Object.freeze({
  sttProvider: "soniox",
  apiKey: "test-api-key",
  apiKeyEnvName: "SONIOX_API_KEY",
  apiKeySource: "flag",
  languages: ["en"],
  model: "stt-rt-v4",
  endpoint: "wss://stt-rt.soniox.com/transcribe-websocket",
  sampleRate: 16000,
  enableEndpointDetection: true,
  outputMode: "overwrite" as const,
  verbose: false,
  guardPhrase: "τέλος εντολής",
  protocol: Object.freeze({
    interactionMode: "dictation" as const,
    markers: Object.freeze({
      commandPhrase: "command",
      sectionEndPhrase: "command send",
      sectionEndAliases: Object.freeze(["τέλος εντολής"]),
      sectionCancelPhrase: "command cancel",
      literalNextPhrase: "literal phrase",
    }),
    initialOperators: Object.freeze({
      refine: false,
      translate: false,
      clipboard: false,
      input: false,
    }),
    translationPolicy: "opposite" as const,
    settingSources: Object.freeze({
      operators: Object.freeze({
        refine: "default" as const,
        translate: "default" as const,
        clipboard: "default" as const,
        input: "default" as const,
      }),
      translationPolicy: "default" as const,
    }),
  }),
  llm: Object.freeze({
    enabled: false,
    provider: "azure-openai" as const,
    model: "gpt-5.4",
    systemPrompt: "test",
    requestTimeoutMs: 15000,
    providerConfig: {
      provider: "azure-openai" as const,
      apiKey: "",
      endpoint: "",
      deployment: "gpt-5.4",
      apiVersion: "2024-10-21",
    },
    verbose: false,
  }),
});

/** Returns an argv array that the mocked resolveConfig will accept. */
const GOOD_ARGV = ["node", "untype", "--api-key", "test-api-key"];

function setupGoodConfig(): void {
  resolveConfigImpl = () => GOOD_CONFIG;
}

class FakeSubmitPendingControl {
  private readonly listeners = new Set<SubmitPendingListener>();

  subscribe(listener: SubmitPendingListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async submit(): Promise<void> {
    await Promise.all(Array.from(this.listeners, (listener) => listener()));
  }
}

class FakeProtocolFeatureToggleControl {
  private readonly listeners = new Set<ProtocolFeatureToggleListener>();

  subscribeProtocolFeatureToggle(listener: ProtocolFeatureToggleListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  toggle(key: "refine" | "translate" | "clipboard" | "input"): void {
    for (const listener of this.listeners) {
      listener(key);
    }
  }
}

// --------------------------------------------------------------------------
// beforeEach / afterEach
// --------------------------------------------------------------------------

beforeEach(() => {
  fakeMic = new FakeMicSource();
  fakeTranscriber = new FakeTranscriber();
  fakeRenderer = new FakeRenderer();
  loadPersistedProtocolSettingsMock = vi.fn(() => null);
  savePersistedProtocolSettingsMock = vi.fn();
  setupGoodConfig();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// --------------------------------------------------------------------------
// Happy path
// --------------------------------------------------------------------------

describe("main() — happy path", () => {
  it("wires transcriber callbacks, starts transcriber and mic, then shuts down cleanly on mic 'end', returns 0", async () => {
    let mainPromise: Promise<number>;

    fakeTranscriber.start = vi.fn(async () => {});
    fakeTranscriber.stop = vi.fn(async () => {});
    fakeMic.start = vi.fn(async () => {});
    fakeMic.stop = vi.fn(async () => {});

    mainPromise = main(GOOD_ARGV);

    // Let async tasks in the event queue run.
    await vi.runAllTimersAsync();

    // Trigger clean shutdown by ending the audio stream.
    fakeMic.audio.push(null);

    await vi.runAllTimersAsync();

    const code = await mainPromise;

    expect(code).toBe(0);
    expect(fakeTranscriber.start).toHaveBeenCalledOnce();
    expect(fakeMic.start).toHaveBeenCalledOnce();
    expect(fakeTranscriber.onPartial).toHaveBeenCalledOnce();
    expect(fakeTranscriber.onFinal).toHaveBeenCalledOnce();
    expect(fakeTranscriber.onError).toHaveBeenCalledOnce();
    expect(fakeRenderer.dispose).toHaveBeenCalledOnce();
    expect(savePersistedProtocolSettingsMock).toHaveBeenCalledOnce();
  });

  it("forwards partial and final callbacks to the renderer", async () => {
    fakeTranscriber.start = vi.fn(async () => {});
    fakeTranscriber.stop = vi.fn(async () => {});

    const mainPromise = main(GOOD_ARGV);
    await vi.runAllTimersAsync();

    // Trigger partial and final before shutdown.
    fakeTranscriber._partialCb?.("hello");
    fakeTranscriber._finalCb?.("hello world");

    // Shutdown.
    fakeMic.audio.push(null);
    await vi.runAllTimersAsync();
    await mainPromise;

    expect(fakeRenderer.partial).toHaveBeenCalledWith("hello");
    expect(fakeRenderer.final).toHaveBeenCalledWith("hello world");
  });

  it("sends mic audio chunks to transcriber.pushAudio (via data event)", async () => {
    fakeTranscriber.start = vi.fn(async () => {});
    fakeTranscriber.stop = vi.fn(async () => {});

    const mainPromise = main(GOOD_ARGV);
    await vi.runAllTimersAsync();

    const chunk = Buffer.from([1, 2, 3]);
    fakeMic.audio.write(chunk);
    expect(fakeTranscriber.pushAudio).toHaveBeenCalledWith(chunk);

    fakeMic.audio.push(null);
    await vi.runAllTimersAsync();
    await mainPromise;
  });

  it("sends silence while the audio gate is closed and real audio when open", async () => {
    let gateOpen = false;
    const mainPromise = runMicSession(GOOD_ARGV, {
      frontend: "ui",
      handleProcessSignals: false,
      audioGate: {
        isOpen: () => gateOpen,
      },
    });
    await vi.runAllTimersAsync();

    const hiddenChunk = Buffer.from([1, 2, 3, 4]);
    fakeMic.audio.write(hiddenChunk);
    expect(fakeTranscriber.pushAudio).toHaveBeenLastCalledWith(Buffer.alloc(hiddenChunk.length));

    gateOpen = true;
    const liveChunk = Buffer.from([5, 6, 7, 8]);
    fakeMic.audio.write(liveChunk);
    expect(fakeTranscriber.pushAudio).toHaveBeenLastCalledWith(liveChunk);

    fakeMic.audio.push(null);
    await vi.runAllTimersAsync();
    await mainPromise;
  });

  it("commits and submits pending text without stopping a warmed session", async () => {
    const events: unknown[] = [];
    const submitPendingControl = new FakeSubmitPendingControl();
    const abort = new AbortController();
    const mainPromise = runMicSession(GOOD_ARGV, {
      frontend: "ui",
      handleProcessSignals: false,
      abortSignal: abort.signal,
      submitPendingControl,
      onEvent: (event) => events.push(event),
    });
    await vi.runAllTimersAsync();

    fakeTranscriber._finalCb?.("hotkey dictated text");
    await submitPendingControl.submit();
    await vi.runAllTimersAsync();

    expect(fakeTranscriber.commit).toHaveBeenCalledOnce();
    expect(fakeTranscriber.stop).not.toHaveBeenCalled();
    expect(fakeMic.stop).not.toHaveBeenCalled();
    expect(events.some((event) =>
      typeof event === "object" &&
      event !== null &&
      (event as { type?: unknown }).type === "protocol.event" &&
      ((event as { event?: { type?: unknown; raw_text?: unknown } }).event?.type === "section.submitted") &&
      ((event as { event?: { raw_text?: unknown } }).event?.raw_text === "hotkey dictated text")
    )).toBe(true);

    abort.abort({ submitPending: false });
    await vi.runAllTimersAsync();
    await mainPromise;
  });

  it("applies runtime protocol feature toggles during an active UI session", async () => {
    const events: unknown[] = [];
    const protocolFeatureToggleControl = new FakeProtocolFeatureToggleControl();
    const abort = new AbortController();
    const mainPromise = runMicSession(GOOD_ARGV, {
      frontend: "ui",
      handleProcessSignals: false,
      abortSignal: abort.signal,
      protocolFeatureToggleControl,
      onEvent: (event) => events.push(event),
    });
    await vi.runAllTimersAsync();

    protocolFeatureToggleControl.toggle("clipboard");
    await vi.runAllTimersAsync();

    expect(events.some((event) =>
      typeof event === "object" &&
      event !== null &&
      (event as { type?: unknown }).type === "protocol.event" &&
      ((event as { event?: { type?: unknown; key?: unknown; value?: unknown } }).event?.type === "state.changed") &&
      ((event as { event?: { key?: unknown } }).event?.key === "clipboard") &&
      ((event as { event?: { value?: unknown } }).event?.value === true)
    )).toBe(true);

    abort.abort({ submitPending: false });
    await vi.runAllTimersAsync();
    await mainPromise;
  });

  it("writes a ready-to-listen message to stderr after startup", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const mainPromise = main(GOOD_ARGV);
    await vi.runAllTimersAsync();

    const stderrText = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrText).toContain(
      "[untype] Ready to listen. Press Control-C to stop the listening tool.",
    );

    fakeMic.audio.push(null);
    await vi.runAllTimersAsync();
    await mainPromise;
    stderr.mockRestore();
  });
});

// --------------------------------------------------------------------------
// Config failure paths
// --------------------------------------------------------------------------

describe("main() — config failures", () => {
  it("returns 0 on HelpOrVersionShown, never starts mic or transcriber", async () => {
    resolveConfigImpl = () => { throw new HelpOrVersionShown("help"); };

    const code = await main(["node", "untype", "--help"]);

    expect(code).toBe(0);
    expect(fakeTranscriber.start).not.toHaveBeenCalled();
    expect(fakeMic.start).not.toHaveBeenCalled();
  });

  it("returns 2 on MissingConfigurationError, never starts mic or transcriber", async () => {
    resolveConfigImpl = () => {
      throw new MissingConfigurationError("SONIOX_API_KEY is not set");
    };

    const code = await main(["node", "untype"]);

    expect(code).toBe(2);
    expect(fakeTranscriber.start).not.toHaveBeenCalled();
    expect(fakeMic.start).not.toHaveBeenCalled();
    expect(fakeRenderer.dispose).not.toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------------
// Soniox start failure (auth)
// --------------------------------------------------------------------------

describe("main() — Soniox auth failure", () => {
  it("returns 4 when transcriber.start() throws SonioxAuthError, never starts mic, disposes renderer", async () => {
    fakeTranscriber.start = vi.fn(async () => {
      throw new SonioxAuthError("invalid key");
    });

    const code = await main(GOOD_ARGV);

    expect(code).toBe(4);
    expect(fakeMic.start).not.toHaveBeenCalled();
    expect(fakeRenderer.dispose).toHaveBeenCalledOnce();
  });

  it("returns 5 when transcriber.start() throws SonioxNetworkError", async () => {
    fakeTranscriber.start = vi.fn(async () => {
      throw new SonioxNetworkError("connection refused");
    });

    const code = await main(GOOD_ARGV);

    expect(code).toBe(5);
    expect(fakeMic.start).not.toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------------
// Mic start failure (after Soniox connected)
// --------------------------------------------------------------------------

describe("main() — mic start failure after Soniox connected", () => {
  it("returns 3 and calls transcriber.stop() when mic.start() throws MicNotAvailableError", async () => {
    fakeTranscriber.start = vi.fn(async () => {});
    fakeTranscriber.stop = vi.fn(async () => {});
    fakeMic.start = vi.fn(async () => {
      throw new MicNotAvailableError("sox not installed");
    });

    const code = await main(GOOD_ARGV);

    expect(code).toBe(3);
    expect(fakeTranscriber.start).toHaveBeenCalledOnce();
    expect(fakeTranscriber.stop).toHaveBeenCalledOnce();
    expect(fakeRenderer.dispose).toHaveBeenCalledOnce();
  });

  it("returns 3 and calls transcriber.stop() when mic.start() throws MicPermissionDeniedError", async () => {
    fakeTranscriber.start = vi.fn(async () => {});
    fakeTranscriber.stop = vi.fn(async () => {});
    fakeMic.start = vi.fn(async () => {
      throw new MicPermissionDeniedError("permission denied");
    });

    const code = await main(GOOD_ARGV);

    expect(code).toBe(3);
    expect(fakeTranscriber.stop).toHaveBeenCalledOnce();
  });
});

// --------------------------------------------------------------------------
// Async transcriber error during session
// --------------------------------------------------------------------------

describe("main() — async transcriber error during session", () => {
  it("triggers shutdown and returns the error's exit code", async () => {
    fakeTranscriber.start = vi.fn(async () => {});
    fakeTranscriber.stop = vi.fn(async () => {});
    fakeMic.start = vi.fn(async () => {});
    fakeMic.stop = vi.fn(async () => { fakeMic.audio.push(null); });

    const mainPromise = main(GOOD_ARGV);
    await vi.runAllTimersAsync();

    // Simulate a mid-stream network error from the transcriber.
    fakeTranscriber._errorCb?.(new SonioxNetworkError("connection lost"));

    await vi.runAllTimersAsync();
    const code = await mainPromise;

    expect(code).toBe(5);
    expect(fakeMic.stop).toHaveBeenCalledOnce();
    expect(fakeTranscriber.stop).toHaveBeenCalledOnce();
    expect(fakeRenderer.dispose).toHaveBeenCalledOnce();
  });
});

// --------------------------------------------------------------------------
// Mic audio error during session
// --------------------------------------------------------------------------

describe("main() — mic audio error during session", () => {
  it("triggers shutdown and returns the error's exit code", async () => {
    fakeTranscriber.start = vi.fn(async () => {});
    fakeTranscriber.stop = vi.fn(async () => {});
    fakeMic.start = vi.fn(async () => {});
    fakeMic.stop = vi.fn(async () => {});

    const mainPromise = main(GOOD_ARGV);
    await vi.runAllTimersAsync();

    // Emit an error on the audio stream.
    fakeMic.audio.emit("error", new MicNotAvailableError("unexpected exit"));

    await vi.runAllTimersAsync();
    const code = await mainPromise;

    expect(code).toBe(3);
    expect(fakeRenderer.dispose).toHaveBeenCalledOnce();
  });
});

// --------------------------------------------------------------------------
// SIGINT during active session
// --------------------------------------------------------------------------

describe("main() — SIGINT handling", () => {
  it("shuts down cleanly on SIGINT and returns 0", async () => {
    fakeTranscriber.start = vi.fn(async () => {});
    fakeTranscriber.stop = vi.fn(async () => {});
    fakeMic.start = vi.fn(async () => {});
    fakeMic.stop = vi.fn(async () => { fakeMic.audio.push(null); });

    const mainPromise = main(GOOD_ARGV);
    await vi.runAllTimersAsync();

    // Emit SIGINT.
    process.emit("SIGINT");

    await vi.runAllTimersAsync();
    const code = await mainPromise;

    expect(code).toBe(0);
    expect(fakeMic.stop).toHaveBeenCalledOnce();
    expect(fakeTranscriber.stop).toHaveBeenCalledOnce();
    expect(fakeRenderer.dispose).toHaveBeenCalledOnce();
  });

  it("calls process.exit(130) on second SIGINT during an in-flight shutdown", async () => {
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((_code?: number) => { throw new Error("process.exit called"); });

    fakeTranscriber.start = vi.fn(async () => {});
    // Make transcriber.stop() hang so shutdown never completes.
    fakeTranscriber.stop = vi.fn(async () => new Promise<void>(() => { /* hang */ }));
    fakeMic.start = vi.fn(async () => {});
    fakeMic.stop = vi.fn(async () => {});

    const mainPromise = main(GOOD_ARGV);
    await vi.runAllTimersAsync();

    // First SIGINT — starts shutdown.
    process.emit("SIGINT");
    await vi.runAllTimersAsync();

    // Second SIGINT — should call process.exit(130).
    expect(() => process.emit("SIGINT")).toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(130);

    exitSpy.mockRestore();
    // Clean up the hanging promise by resolving it.
    (fakeTranscriber.stop as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    await vi.runAllTimersAsync();
    // mainPromise may never resolve due to the hung stop; that's expected.
  });
});

// --------------------------------------------------------------------------
// Idempotent shutdown
// --------------------------------------------------------------------------

describe("main() — idempotent shutdown", () => {
  it("two concurrent event-channel shutdown triggers produce a single teardown sequence", async () => {
    fakeTranscriber.start = vi.fn(async () => {});
    fakeTranscriber.stop = vi.fn(async () => {});
    fakeMic.start = vi.fn(async () => {});
    fakeMic.stop = vi.fn(async () => {});

    const mainPromise = main(GOOD_ARGV);
    await vi.runAllTimersAsync();

    // Trigger shutdown via mic audio error (event channel, not signal).
    fakeMic.audio.emit("error", new MicNotAvailableError("device lost"));
    // Trigger a second shutdown path at the same time (transcriber error).
    fakeTranscriber._errorCb?.(new SonioxNetworkError("also lost"));

    // Let the shutdown tasks complete.
    await vi.runAllTimersAsync();
    await mainPromise;

    // Even with two triggers, each cleanup function is called exactly once.
    expect(fakeMic.stop).toHaveBeenCalledOnce();
    expect(fakeTranscriber.stop).toHaveBeenCalledOnce();
    expect(fakeRenderer.dispose).toHaveBeenCalledOnce();
  });
});
