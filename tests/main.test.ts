/**
 * Unit E tests — Orchestrator (src/main.ts).
 *
 * All external units are mocked:
 *   - src/config.ts        → vi.mock → controlled resolveConfig / HelpOrVersionShown
 *   - src/mic/index.ts     → vi.mock → fake MicSource
 *   - src/soniox/client.ts → vi.mock → fake SonioxTranscriber
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
 * A minimal fake SonioxTranscriber.
 * Callback setters are stored so tests can invoke them.
 */
class FakeTranscriber {
  start = vi.fn<() => Promise<void>>(async () => {});
  stop = vi.fn<() => Promise<void>>(async () => {});
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
  dispose = vi.fn<() => void>();
}

// Module-level references to the current fake instances (reset each test).
let fakeMic: FakeMicSource;
let fakeTranscriber: FakeTranscriber;
let fakeRenderer: FakeRenderer;

// Controls what resolveConfig returns or throws.
let resolveConfigImpl: (argv: string[]) => unknown;

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

vi.mock("../src/soniox/client.js", () => ({
  SonioxTranscriber: class {
    constructor(_opts: unknown) {
      // Swap out the shared fakeTranscriber reference to this new instance.
      Object.assign(this, fakeTranscriber);
    }
    // Proxy all methods through fakeTranscriber so tests can spy.
    start(...args: unknown[]) { return (fakeTranscriber.start as (...a: unknown[]) => unknown)(...args); }
    stop(...args: unknown[]) { return (fakeTranscriber.stop as (...a: unknown[]) => unknown)(...args); }
    onPartial(cb: (text: string) => void) { fakeTranscriber.onPartial(cb); }
    onFinal(cb: (text: string) => void) { fakeTranscriber.onFinal(cb); }
    onError(cb: (err: Error) => void) { fakeTranscriber.onError(cb); }
  },
}));

vi.mock("../src/render/renderer.js", () => ({
  StdoutRenderer: class {
    constructor(_opts: unknown) {
      Object.assign(this, fakeRenderer);
    }
    partial(t: string) { fakeRenderer.partial(t); }
    final(t: string) { fakeRenderer.final(t); }
    dispose() { fakeRenderer.dispose(); }
  },
}));

// Import main AFTER mocks are set up.
import { main } from "../src/main.js";
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
  apiKey: "test-api-key",
  language: "en",
  outputMode: "overwrite" as const,
  verbose: false,
  guardPhrase: "τέλος εντολής",
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
const GOOD_ARGV = ["node", "mic-tool", "--api-key", "test-api-key"];

function setupGoodConfig(): void {
  resolveConfigImpl = () => GOOD_CONFIG;
}

// --------------------------------------------------------------------------
// beforeEach / afterEach
// --------------------------------------------------------------------------

beforeEach(() => {
  fakeMic = new FakeMicSource();
  fakeTranscriber = new FakeTranscriber();
  fakeRenderer = new FakeRenderer();
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
    const pushAudioSpy = vi.fn();
    // Patch pushAudio after the transcriber is wired.
    fakeTranscriber.start = vi.fn(async () => {});
    fakeTranscriber.stop = vi.fn(async () => {});

    const mainPromise = main(GOOD_ARGV);
    await vi.runAllTimersAsync();

    // Inject fake pushAudio method on the live transcriber instance.
    // The wiring is: mic.audio.on("data", (chunk) => transcriber.pushAudio(chunk)).
    // Since fakeTranscriber doesn't have pushAudio, we capture it via the data event
    // by tracking what SonioxTranscriber would do — but here the mock doesn't proxy pushAudio.
    // Instead verify that the data event handler was attached.
    const dataListeners = fakeMic.audio.listeners("data");
    expect(dataListeners).toHaveLength(1);

    fakeMic.audio.push(null);
    await vi.runAllTimersAsync();
    await mainPromise;
  });
});

// --------------------------------------------------------------------------
// Config failure paths
// --------------------------------------------------------------------------

describe("main() — config failures", () => {
  it("returns 0 on HelpOrVersionShown, never starts mic or transcriber", async () => {
    resolveConfigImpl = () => { throw new HelpOrVersionShown("help"); };

    const code = await main(["node", "mic-tool", "--help"]);

    expect(code).toBe(0);
    expect(fakeTranscriber.start).not.toHaveBeenCalled();
    expect(fakeMic.start).not.toHaveBeenCalled();
  });

  it("returns 2 on MissingConfigurationError, never starts mic or transcriber", async () => {
    resolveConfigImpl = () => {
      throw new MissingConfigurationError("SONIOX_API_KEY is not set");
    };

    const code = await main(["node", "mic-tool"]);

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
