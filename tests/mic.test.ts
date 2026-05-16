/**
 * Unit B tests — Mic factory (src/mic/index.ts) + SoxMicSource (src/mic/soxMicSource.ts).
 *
 * All tests mock `node:child_process` so no real `sox` binary is required.
 * Fake timers are used to advance the 200 ms start-grace window and the
 * 500 ms SIGKILL fallback without real-time waiting.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

// --------------------------------------------------------------------------
// Module mocks
// --------------------------------------------------------------------------

// vi.mock is hoisted; factory cannot reference top-level variables.
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

// Access the mocked spawn through the module binding.
import * as childProcessMock from "node:child_process";
const spawnSpy = childProcessMock.spawn as unknown as Mock;

// Units under test.
import { SoxMicSource } from "../src/mic/soxMicSource.js";
import {
  MicNotAvailableError,
  MicPermissionDeniedError,
  UnsupportedPlatformError,
} from "../src/errors.js";

// --------------------------------------------------------------------------
// Fake child-process factory
// --------------------------------------------------------------------------

function makeFakeChild(options: {
  pid?: number;
  spawnError?: NodeJS.ErrnoException;
  exitCode?: number | null;
  exitSignal?: NodeJS.Signals | null;
  exitAfterMs?: number;
  stderrChunks?: string[];
}) {
  const emitter = new EventEmitter();
  const fakeStdout = new PassThrough();
  const fakeStderr = new PassThrough();

  const child = Object.assign(emitter, {
    pid: options.pid ?? 99999,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    stdout: fakeStdout as Readable,
    stderr: fakeStderr as Readable,
    kill: vi.fn<(signal?: NodeJS.Signals | string) => boolean>((_sig) => {
      if (options.exitAfterMs === undefined && !options.spawnError) {
        child.exitCode = 0;
        // Use Promise.resolve().then so the exit callback runs in the microtask
        // queue rather than via setImmediate/setTimeout, keeping it under
        // vitest's fake-timer control.
        Promise.resolve().then(() => child.emit("exit", 0, null));
      }
      return true;
    }),
  });

  if (options.stderrChunks?.length) {
    for (const chunk of options.stderrChunks) {
      // Schedule via Promise.resolve() so the emission is immediate-ish but
      // deterministic and not subject to setImmediate timing.
      Promise.resolve().then(() => fakeStderr.push(chunk));
    }
  }
  if (options.spawnError) {
    const err = options.spawnError;
    // Defer via microtask so the caller's .catch() is attached before we emit.
    Promise.resolve().then(() => child.emit("error", err));
  }
  if (options.exitAfterMs !== undefined) {
    const code = options.exitCode ?? null;
    const signal = options.exitSignal ?? null;
    setTimeout(() => {
      child.exitCode = code;
      child.signalCode = signal;
      child.emit("exit", code, signal);
    }, options.exitAfterMs);
  }

  return child as unknown as ChildProcessByStdio<null, Readable, Readable>;
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

const START_GRACE_MS = 200;
const STOP_GRACE_MS = 500;

function collectAudioErrors(mic: SoxMicSource): Error[] {
  const errors: Error[] = [];
  mic.audio.on("error", (err: Error) => errors.push(err));
  return errors;
}

/**
 * Create a "rejection collector" pair: a promise that will be pre-attached as
 * a .catch() handler, plus an assertion function.
 *
 * Usage:
 *   const [caughtP, assertCaught] = makeRejectionCollector();
 *   const startP = mic.start();
 *   // attach catch SYNCHRONOUSLY before any timer advancement:
 *   startP.catch(caughtP.resolve);
 *   await vi.advanceTimersByTimeAsync(...);
 *   const err = await caughtP.promise;
 *   assertCaught(err, MicNotAvailableError, /message/);
 *
 * This pattern ensures the catch handler is always registered before the
 * Promise settles, preventing the "unhandled rejection" warning.
 */
function makeRejectionCollector() {
  let resolveErr!: (err: unknown) => void;
  const promise = new Promise<unknown>((resolve) => { resolveErr = resolve; });
  return {
    catch: (err: unknown) => resolveErr(err),
    promise,
    assert(ctor: new (...args: unknown[]) => Error, msgPattern?: string | RegExp) {
      return promise.then((err) => {
        expect(err).toBeInstanceOf(ctor);
        if (msgPattern !== undefined) {
          expect((err as Error).message).toMatch(msgPattern);
        }
      });
    },
  };
}

// --------------------------------------------------------------------------
// SoxMicSource — start() happy path
// --------------------------------------------------------------------------

describe("SoxMicSource — start() happy path", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval",
               "setImmediate", "clearImmediate", "Date"],
    });
    spawnSpy.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves after the 200 ms grace window when the child stays alive", async () => {
    const child = makeFakeChild({ pid: 12345 });
    spawnSpy.mockReturnValue(child);

    const mic = new SoxMicSource();
    const startPromise = mic.start();
    await vi.advanceTimersByTimeAsync(START_GRACE_MS + 10);
    await expect(startPromise).resolves.toBeUndefined();
  });

  it("spawns sox with the correct locked argv and stdio options", async () => {
    const child = makeFakeChild({ pid: 12345 });
    spawnSpy.mockReturnValue(child);

    const mic = new SoxMicSource();
    const startPromise = mic.start();
    await vi.advanceTimersByTimeAsync(START_GRACE_MS + 10);
    await startPromise;

    expect(spawnSpy).toHaveBeenCalledOnce();
    const [cmd, args, opts] = spawnSpy.mock.calls[0];
    expect(cmd).toBe("sox");
    expect(args).toEqual([
      "-q", "-d", "-t", "raw", "-r", "16000", "-c", "1",
      "-b", "16", "-e", "signed-integer", "-L", "-",
    ]);
    expect(opts).toMatchObject({ stdio: ["ignore", "pipe", "pipe"] });
  });

  it("exposes a Readable audio stream that receives data from child stdout", async () => {
    const child = makeFakeChild({ pid: 12345 });
    spawnSpy.mockReturnValue(child);

    const mic = new SoxMicSource();
    const startPromise = mic.start();
    await vi.advanceTimersByTimeAsync(START_GRACE_MS + 10);
    await startPromise;

    const chunks: Buffer[] = [];
    mic.audio.on("data", (chunk: Buffer) => chunks.push(chunk));

    (child.stdout as PassThrough).push(Buffer.from([0x01, 0x02, 0x03, 0x04]));
    await vi.runAllTimersAsync();

    expect(chunks.length).toBeGreaterThan(0);
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([0x01, 0x02, 0x03, 0x04]));
  });
});

// --------------------------------------------------------------------------
// SoxMicSource — start() ENOENT
// --------------------------------------------------------------------------

describe("SoxMicSource — start() ENOENT → MicNotAvailableError", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval",
               "setImmediate", "clearImmediate", "Date"],
    });
    spawnSpy.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects with MicNotAvailableError when spawn emits ENOENT", async () => {
    const enoent = Object.assign(new Error("spawn sox ENOENT"), {
      code: "ENOENT",
    }) as NodeJS.ErrnoException;
    const child = makeFakeChild({ spawnError: enoent });
    spawnSpy.mockReturnValue(child);

    const mic = new SoxMicSource();
    const collector = makeRejectionCollector();
    const startPromise = mic.start();
    // Attach catch handler SYNCHRONOUSLY before any timer advance.
    startPromise.catch(collector.catch);
    await Promise.resolve();
    await vi.runAllTimersAsync();
    await collector.assert(MicNotAvailableError, "sox not installed");
  });
});

// --------------------------------------------------------------------------
// SoxMicSource — permission-denied stderr
// --------------------------------------------------------------------------

describe("SoxMicSource — start() permission stderr → MicPermissionDeniedError", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval",
               "setImmediate", "clearImmediate", "Date"],
    });
    spawnSpy.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects with MicPermissionDeniedError on 'not allowed' + CoreAudio in stderr", async () => {
    const child = makeFakeChild({
      stderrChunks: [
        "sox FAIL formats: can't open output `default': CoreAudio device: not allowed\n",
      ],
      exitCode: 2,
      exitAfterMs: 50,
    });
    spawnSpy.mockReturnValue(child);

    const mic = new SoxMicSource();
    const collector = makeRejectionCollector();
    const startPromise = mic.start();
    startPromise.catch(collector.catch);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(100);
    await collector.assert(MicPermissionDeniedError, /Microphone access denied/);
  });

  it("rejects with MicPermissionDeniedError when stderr contains 'permission'", async () => {
    const child = makeFakeChild({
      stderrChunks: ["sox: permission denied\n"],
      exitCode: 2,
      exitAfterMs: 50,
    });
    spawnSpy.mockReturnValue(child);

    const mic = new SoxMicSource();
    const collector = makeRejectionCollector();
    const startPromise = mic.start();
    startPromise.catch(collector.catch);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(100);
    await collector.assert(MicPermissionDeniedError);
  });

  it("rejects with MicPermissionDeniedError when stderr mentions 'not authorized'", async () => {
    const child = makeFakeChild({
      stderrChunks: ["sox: input device not authorized\n"],
      exitCode: 2,
      exitAfterMs: 50,
    });
    spawnSpy.mockReturnValue(child);

    const mic = new SoxMicSource();
    const collector = makeRejectionCollector();
    const startPromise = mic.start();
    startPromise.catch(collector.catch);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(100);
    await collector.assert(MicPermissionDeniedError);
  });
});

// --------------------------------------------------------------------------
// SoxMicSource — no default audio device
// --------------------------------------------------------------------------

describe("SoxMicSource — start() 'no default audio device' → MicNotAvailableError", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval",
               "setImmediate", "clearImmediate", "Date"],
    });
    spawnSpy.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects with MicNotAvailableError on 'No default audio device' in stderr", async () => {
    const child = makeFakeChild({
      stderrChunks: [
        "sox FAIL formats: can't open input `default': No default audio device\n",
      ],
      exitCode: 2,
      exitAfterMs: 50,
    });
    spawnSpy.mockReturnValue(child);

    const mic = new SoxMicSource();
    const collector = makeRejectionCollector();
    const startPromise = mic.start();
    startPromise.catch(collector.catch);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(100);
    await collector.assert(MicNotAvailableError, /No default audio input device/);
  });

  it("rejects with MicNotAvailableError on \"can't open\" in stderr", async () => {
    const child = makeFakeChild({
      stderrChunks: ["sox: can't open input device\n"],
      exitCode: 2,
      exitAfterMs: 50,
    });
    spawnSpy.mockReturnValue(child);

    const mic = new SoxMicSource();
    const collector = makeRejectionCollector();
    const startPromise = mic.start();
    startPromise.catch(collector.catch);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(100);
    await collector.assert(MicNotAvailableError);
  });
});

// --------------------------------------------------------------------------
// SoxMicSource — mid-stream unexpected exit
// --------------------------------------------------------------------------

describe("SoxMicSource — mid-stream unexpected exit", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval",
               "setImmediate", "clearImmediate", "Date"],
    });
    spawnSpy.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits MicNotAvailableError on audio stream when child exits unexpectedly after start resolved", async () => {
    const child = makeFakeChild({ pid: 12345 });
    spawnSpy.mockReturnValue(child);

    const mic = new SoxMicSource();
    const audioErrors = collectAudioErrors(mic);

    const startPromise = mic.start();
    await vi.advanceTimersByTimeAsync(START_GRACE_MS + 10);
    await startPromise;

    // Unexpected exit after start resolved.
    child.exitCode = 1;
    child.emit("exit", 1, null);
    await vi.runAllTimersAsync();

    expect(audioErrors).toHaveLength(1);
    expect(audioErrors[0]).toBeInstanceOf(MicNotAvailableError);
    expect(audioErrors[0].message).toMatch(/unexpectedly/);
  });
});

// --------------------------------------------------------------------------
// SoxMicSource — stop()
// --------------------------------------------------------------------------

describe("SoxMicSource — stop() SIGTERM + SIGKILL fallback", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval",
               "setImmediate", "clearImmediate", "Date"],
    });
    spawnSpy.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends SIGTERM and resolves once the child exits cleanly", async () => {
    const child = makeFakeChild({ pid: 12345 });
    (child.kill as Mock).mockImplementation((_sig?: string) => {
      setImmediate(() => {
        child.exitCode = 0;
        child.emit("exit", 0, null);
      });
      return true;
    });
    spawnSpy.mockReturnValue(child);

    const mic = new SoxMicSource();
    const startPromise = mic.start();
    await vi.advanceTimersByTimeAsync(START_GRACE_MS + 10);
    await startPromise;

    const stopPromise = mic.stop();
    await vi.runAllTimersAsync();
    await stopPromise;

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("falls back to SIGKILL when child does not exit within 500 ms", async () => {
    const killMock = vi.fn<(signal?: NodeJS.Signals | string) => boolean>(() => true);
    const child = makeFakeChild({ pid: 12345 });
    (child as unknown as { kill: Mock }).kill = killMock;
    spawnSpy.mockReturnValue(child);

    const mic = new SoxMicSource();
    const startPromise = mic.start();
    await vi.advanceTimersByTimeAsync(START_GRACE_MS + 10);
    await startPromise;

    const stopPromise = mic.stop();
    await vi.advanceTimersByTimeAsync(STOP_GRACE_MS + 10);

    // Simulate child dying after SIGKILL.
    child.exitCode = null;
    child.signalCode = "SIGKILL";
    child.emit("exit", null, "SIGKILL");

    await vi.runAllTimersAsync();
    await stopPromise;

    expect(killMock).toHaveBeenCalledWith("SIGTERM");
    expect(killMock).toHaveBeenCalledWith("SIGKILL");
  });

  it("is idempotent — calling stop() twice resolves both and sends SIGTERM once", async () => {
    const child = makeFakeChild({ pid: 12345 });
    (child.kill as Mock).mockImplementation((_sig?: string) => {
      setImmediate(() => {
        child.exitCode = 0;
        child.emit("exit", 0, null);
      });
      return true;
    });
    spawnSpy.mockReturnValue(child);

    const mic = new SoxMicSource();
    const startPromise = mic.start();
    await vi.advanceTimersByTimeAsync(START_GRACE_MS + 10);
    await startPromise;

    // Start both stop() calls concurrently.
    const p1 = mic.stop();
    const p2 = mic.stop();
    // Drain timers and immediates so the exit events fire.
    await vi.runAllTimersAsync();
    const results = await Promise.allSettled([p1, p2]);

    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("fulfilled");

    const sigtermCalls = (child.kill as Mock).mock.calls.filter(
      (c) => c[0] === "SIGTERM",
    );
    expect(sigtermCalls).toHaveLength(1);
  });

  it("stop() on idle mic resolves immediately without error", async () => {
    const mic = new SoxMicSource();
    await expect(mic.stop()).resolves.toBeUndefined();
  });
});

// --------------------------------------------------------------------------
// SoxMicSource — double start() rejection
// --------------------------------------------------------------------------

describe("SoxMicSource — double start() rejection", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval",
               "setImmediate", "clearImmediate", "Date"],
    });
    spawnSpy.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects second start() with a plain Error", async () => {
    const child = makeFakeChild({ pid: 12345 });
    spawnSpy.mockReturnValue(child);

    const mic = new SoxMicSource();
    const firstStart = mic.start();
    await vi.advanceTimersByTimeAsync(START_GRACE_MS + 10);
    await firstStart;

    await expect(mic.start()).rejects.toThrow("SoxMicSource already started");
  });
});

// --------------------------------------------------------------------------
// Mic factory — platform dispatch
// --------------------------------------------------------------------------

describe("createMicSource() — platform dispatch", () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      writable: true,
      configurable: true,
    });
    vi.resetModules();
  });

  it("returns a SoxMicSource on darwin", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      writable: true,
      configurable: true,
    });

    const { createMicSource } = await import("../src/mic/index.js");
    const source = createMicSource();
    expect(source).toBeInstanceOf(SoxMicSource);
  });

  it("throws on linux with a message mentioning 'macOS only'", async () => {
    Object.defineProperty(process, "platform", {
      value: "linux",
      writable: true,
      configurable: true,
    });

    const { createMicSource } = await import("../src/mic/index.js");
    // Import the error class from the SAME module resolution path after reset
    // to avoid instanceof cross-realm mismatch.
    const { UnsupportedPlatformError: FreshUnsupportedPlatformError } =
      await import("../src/errors.js");

    expect(() => createMicSource()).toThrow(FreshUnsupportedPlatformError);
    expect(() => createMicSource()).toThrow(/macOS only/);
  });

  it("throws on win32 with a message mentioning 'macOS only'", async () => {
    Object.defineProperty(process, "platform", {
      value: "win32",
      writable: true,
      configurable: true,
    });

    const { createMicSource } = await import("../src/mic/index.js");
    const { UnsupportedPlatformError: FreshUPE } = await import("../src/errors.js");
    expect(() => createMicSource()).toThrow(FreshUPE);
    expect(() => createMicSource()).toThrow(/macOS only/);
  });
});
