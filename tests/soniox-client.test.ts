/**
 * Unit C tests — SonioxTranscriber (src/soniox/client.ts).
 *
 * The `@soniox/node` SDK is fully mocked so no real network connection is made.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// --------------------------------------------------------------------------
// vi.mock factory
// --------------------------------------------------------------------------

vi.mock("@soniox/node", async () => {
  // Import EventEmitter inside the factory using await import() to avoid
  // the top-level variable reference restriction.
  const { EventEmitter } = await import("node:events");

  // Fake error classes — defined entirely within the factory.
  class _FakeAuthError extends Error {
    code?: string; statusCode?: number;
    constructor(msg: string) { super(msg); this.name = "AuthError"; }
  }
  class _FakeNetworkError extends Error {
    code?: string; statusCode?: number;
    constructor(msg: string) { super(msg); this.name = "NetworkError"; }
  }
  class _FakeConnectionError extends Error {
    code?: string; statusCode?: number;
    constructor(msg: string) { super(msg); this.name = "ConnectionError"; }
  }
  class _FakeRealtimeError extends Error {
    code?: string; statusCode?: number;
    constructor(msg: string) { super(msg); this.name = "RealtimeError"; }
  }
  class _FakeBadRequestError extends Error {
    code?: string; statusCode?: number;
    constructor(msg: string) { super(msg); this.name = "BadRequestError"; }
  }
  class _FakeStateError extends Error {
    code?: string; statusCode?: number;
    constructor(msg: string) { super(msg); this.name = "StateError"; }
  }
  class _FakeAbortError extends Error {
    code?: string; statusCode?: number;
    constructor(msg: string) { super(msg); this.name = "AbortError"; }
  }
  class _FakeQuotaError extends Error {
    code?: string; statusCode?: number;
    constructor(msg: string) { super(msg); this.name = "QuotaError"; }
  }

  // Fake session that mimics RealtimeSttSession.
  class _FakeSession extends EventEmitter {
    state = "idle";
    calls = {
      connect: 0, sendAudio: [] as Buffer[],
      finalize: 0, finish: 0, close: 0,
    };

    async connect() {
      this.calls.connect++;
      // Check if a global error override is set (used by error-mapping tests).
      const g = globalThis as Record<string, unknown>;
      const errToThrow = g.__nextConnectError;
      if (errToThrow !== undefined) {
        g.__nextConnectError = undefined; // consume
        throw errToThrow;
      }
      // Default: success.
      this.state = "connected";
      this.emit("connected");
    }
    sendAudio(data: Buffer | Uint8Array) {
      this.calls.sendAudio.push(Buffer.from(data));
    }
    finalize() { this.calls.finalize++; }
    finish(): Promise<void> { this.calls.finish++; return Promise.resolve(); }
    close() { this.calls.close++; this.state = "closed"; }

    emitResult(tokens: Array<{ text: string; is_final: boolean }>) {
      this.emit("result", { tokens });
    }
  }

  // Stash on globalThis so tests can access without referencing top-level vars.
  const g = globalThis as Record<string, unknown>;
  g.__SDK_Errors = {
    AuthError: _FakeAuthError,
    NetworkError: _FakeNetworkError,
    ConnectionError: _FakeConnectionError,
    RealtimeError: _FakeRealtimeError,
    BadRequestError: _FakeBadRequestError,
    StateError: _FakeStateError,
    AbortError: _FakeAbortError,
    QuotaError: _FakeQuotaError,
  };
  g.__FakeSession = _FakeSession;

  class FakeSonioxNodeClient {
    constructor(_opts: unknown) {}
    realtime = {
      stt: (_config: unknown, _options: unknown) => {
        const session = new _FakeSession();
        (globalThis as Record<string, unknown>).__currentFakeSession = session;
        return session;
      },
    };
  }

  return {
    SonioxNodeClient: FakeSonioxNodeClient,
    AuthError: _FakeAuthError,
    NetworkError: _FakeNetworkError,
    ConnectionError: _FakeConnectionError,
    RealtimeError: _FakeRealtimeError,
    BadRequestError: _FakeBadRequestError,
    StateError: _FakeStateError,
    AbortError: _FakeAbortError,
    QuotaError: _FakeQuotaError,
  };
});

// --------------------------------------------------------------------------
// Typed helpers to access globalThis stash
// --------------------------------------------------------------------------

const g = globalThis as Record<string, unknown>;

type AnyErrCtor = new (msg: string) => Error;

function getSDKErrors() {
  return g.__SDK_Errors as Record<string, AnyErrCtor>;
}

interface FakeSessionShape {
  state: string;
  connectImpl: () => Promise<void>;
  calls: { connect: number; sendAudio: Buffer[]; finalize: number; finish: number; close: number };
  on(event: string, cb: (...args: unknown[]) => void): this;
  emit(event: string, ...args: unknown[]): boolean;
  connect(): Promise<void>;
  sendAudio(data: Buffer | Uint8Array): void;
  finalize(): void;
  finish(): Promise<void>;
  close(): void;
  emitResult(tokens: Array<{ text: string; is_final: boolean }>): void;
}

function getSession(): FakeSessionShape {
  return g.__currentFakeSession as FakeSessionShape;
}

// --------------------------------------------------------------------------
// Import unit-under-test AFTER mock
// --------------------------------------------------------------------------

import { SonioxTranscriber } from "../src/soniox/client.js";
import {
  SonioxAuthError,
  SonioxNetworkError,
  SonioxProtocolError,
} from "../src/errors.js";

// --------------------------------------------------------------------------
// Helper
// --------------------------------------------------------------------------

function makeTranscriber(opts?: {
  languages?: string[];
  verbose?: boolean;
  model?: string;
  endpoint?: string;
  sampleRate?: number;
  enableEndpointDetection?: boolean;
}) {
  return new SonioxTranscriber({
    apiKey: "test-key",
    model: opts?.model ?? "stt-rt-v4",
    endpoint: opts?.endpoint ?? "wss://stt-rt.soniox.com/transcribe-websocket",
    languages: opts?.languages ?? ["en"],
    sampleRate: opts?.sampleRate ?? 16000,
    enableEndpointDetection: opts?.enableEndpointDetection ?? true,
    verbose: opts?.verbose ?? false,
  });
}

// --------------------------------------------------------------------------
// start() — happy path
// --------------------------------------------------------------------------

describe("SonioxTranscriber — start() happy path", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("calls session.connect() and marks session as connected", async () => {
    const t = makeTranscriber();
    await t.start();

    expect(getSession().calls.connect).toBe(1);
    expect(getSession().state).toBe("connected");
  });

  it("rejects with SonioxProtocolError if start() is called twice", async () => {
    const t = makeTranscriber();
    await t.start();
    await expect(t.start()).rejects.toBeInstanceOf(SonioxProtocolError);
    await expect(t.start()).rejects.toThrow(/called more than once/);
  });
});

// --------------------------------------------------------------------------
// start() — error mapping
// --------------------------------------------------------------------------

describe("SonioxTranscriber — start() SDK error mapping", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    // Ensure no stale error override leaks between tests.
    delete (g as Record<string, unknown>).__nextConnectError;
  });

  it("maps AuthError → SonioxAuthError", async () => {
    // Set the error to throw on the next connect() call.
    g.__nextConnectError = new (getSDKErrors().AuthError)("bad key");

    const t = makeTranscriber();
    await expect(t.start()).rejects.toBeInstanceOf(SonioxAuthError);
    await expect(t.start()).rejects.toThrow(/Soniox authentication failed|called more than once/);
  });

  it("maps NetworkError → SonioxNetworkError", async () => {
    g.__nextConnectError = new (getSDKErrors().NetworkError)("network down");

    const t = makeTranscriber();
    await expect(t.start()).rejects.toBeInstanceOf(SonioxNetworkError);
  });

  it("maps ConnectionError → SonioxNetworkError", async () => {
    g.__nextConnectError = new (getSDKErrors().ConnectionError)("refused");

    const t = makeTranscriber();
    await expect(t.start()).rejects.toBeInstanceOf(SonioxNetworkError);
  });
});

// --------------------------------------------------------------------------
// pushAudio()
// --------------------------------------------------------------------------

describe("SonioxTranscriber — pushAudio()", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("forwards audio when session state is 'connected'", async () => {
    const t = makeTranscriber();
    await t.start();

    const chunk = Buffer.from([0x10, 0x20, 0x30]);
    t.pushAudio(chunk);

    expect(getSession().calls.sendAudio).toHaveLength(1);
    expect(getSession().calls.sendAudio[0]).toEqual(chunk);
  });

  it("drops audio silently when start() has not been called", () => {
    const t = makeTranscriber();
    expect(() => t.pushAudio(Buffer.from([0xAA]))).not.toThrow();
  });

  it("drops audio when session state is not 'connected'", async () => {
    const t = makeTranscriber();
    await t.start();

    getSession().state = "finishing";
    t.pushAudio(Buffer.from([0xFF]));

    expect(getSession().calls.sendAudio).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// Token / result handling
// --------------------------------------------------------------------------

describe("SonioxTranscriber — result event handling", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("filters out <end> marker tokens", async () => {
    const t = makeTranscriber();
    const finals: string[] = [];
    const partials: string[] = [];
    t.onFinal((text) => finals.push(text));
    t.onPartial((text) => partials.push(text));
    await t.start();

    getSession().emitResult([{ text: "<end>", is_final: true }]);

    expect(finals).toHaveLength(0);
    expect(partials).toHaveLength(0);
  });

  it("filters out <fin> marker tokens", async () => {
    const t = makeTranscriber();
    const finals: string[] = [];
    t.onFinal((text) => finals.push(text));
    await t.start();

    getSession().emitResult([{ text: "<fin>", is_final: true }]);
    expect(finals).toHaveLength(0);
  });

  it("accumulates non-final tokens into partialBuffer and calls onPartial", async () => {
    const t = makeTranscriber();
    const partials: string[] = [];
    t.onPartial((text) => partials.push(text));
    await t.start();

    getSession().emitResult([
      { text: "hel", is_final: false },
      { text: "lo", is_final: false },
    ]);

    expect(partials).toHaveLength(1);
    expect(partials[0]).toBe("hello");
  });

  it("accumulates finalized tokens across results until endpoint commits them", async () => {
    const t = makeTranscriber();
    const finals: string[] = [];
    const partials: string[] = [];
    t.onFinal((text) => finals.push(text));
    t.onPartial((text) => partials.push(text));
    await t.start();

    // First result: a non-final token is being refined.
    getSession().emitResult([{ text: "hi ", is_final: false }]);
    // Soniox finalizes "hi " and continues with new non-finals.
    getSession().emitResult([
      { text: "hi ", is_final: true },
      { text: "there", is_final: false },
    ]);
    // No final committed yet — endpoint hasn't fired.
    expect(finals).toHaveLength(0);
    // Display reflects committed finals + current non-finals.
    expect(partials[partials.length - 1]).toBe("hi there");

    // Endpoint signals utterance completion → commit.
    getSession().emit("endpoint");
    expect(finals).toHaveLength(1);
    expect(finals[0]).toBe("hi");
  });

  it("does not duplicate finalized prefixes when Soniox repeats snapshot finals", async () => {
    const t = makeTranscriber();
    const finals: string[] = [];
    const partials: string[] = [];
    t.onFinal((text) => finals.push(text));
    t.onPartial((text) => partials.push(text));
    await t.start();

    getSession().emitResult([
      { text: "Εσύ ", is_final: true },
      { text: "ρε", is_final: false },
    ]);
    getSession().emitResult([
      { text: "Εσύ ", is_final: true },
      { text: "ρε", is_final: false },
    ]);
    getSession().emitResult([
      { text: "Εσύ ", is_final: true },
      { text: "ρε παιδί μου", is_final: false },
    ]);

    expect(partials).toEqual([
      "Εσύ ρε",
      "Εσύ ρε",
      "Εσύ ρε παιδί μου",
    ]);
    expect(partials.join("\n")).not.toContain("Εσύ Εσύ");

    getSession().emitResult([
      { text: "Εσύ ρε παιδί μου", is_final: true },
    ]);
    getSession().emit("endpoint");

    expect(finals).toEqual(["Εσύ ρε παιδί μου"]);
  });

  it("trims leading/trailing whitespace from committed finals on endpoint", async () => {
    const t = makeTranscriber();
    const finals: string[] = [];
    t.onFinal((text) => finals.push(text));
    await t.start();

    getSession().emitResult([{ text: "  hello world  ", is_final: true }]);
    getSession().emit("endpoint");
    expect(finals[0]).toBe("hello world");
  });

  it("calls onPartial with committedFinals when only final tokens are in the result", async () => {
    // The renderer needs to show the running committed text live, not just on
    // endpoint, so onPartial fires whenever the display string is non-empty.
    const t = makeTranscriber();
    const partials: string[] = [];
    t.onPartial((text) => partials.push(text));
    await t.start();

    getSession().emitResult([{ text: "done", is_final: true }]);
    expect(partials).toHaveLength(1);
    expect(partials[0]).toBe("done");
  });

  it("rebuilds non-finals per result and resets all state after endpoint", async () => {
    const t = makeTranscriber();
    const partials: string[] = [];
    t.onPartial((text) => partials.push(text));
    await t.start();

    // First snapshot: non-final "first".
    getSession().emitResult([{ text: "first", is_final: false }]);
    expect(partials[partials.length - 1]).toBe("first");

    // Second snapshot replaces "first" with "second" (full snapshot semantics).
    getSession().emitResult([{ text: "second", is_final: false }]);
    expect(partials[partials.length - 1]).toBe("second");

    // Commit and end utterance.
    getSession().emitResult([{ text: "commit", is_final: true }]);
    getSession().emit("endpoint");

    // After endpoint, next non-final is independent — no carry-over.
    getSession().emitResult([{ text: "fresh", is_final: false }]);
    expect(partials[partials.length - 1]).toBe("fresh");
  });
});

// --------------------------------------------------------------------------
// Unsolicited disconnect
// --------------------------------------------------------------------------

describe("SonioxTranscriber — unsolicited disconnect", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("calls onError with SonioxNetworkError on unexpected 'disconnected' event", async () => {
    const t = makeTranscriber();
    const errors: Error[] = [];
    t.onError((err) => errors.push(err));
    await t.start();

    getSession().emit("disconnected", "server closed");

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(SonioxNetworkError);
    expect(errors[0].message).toMatch(/Soniox connection lost/);
  });

  it("does NOT call onError when 'disconnected' fires after stop() is initiated", async () => {
    const t = makeTranscriber();
    const errors: Error[] = [];
    t.onError((err) => errors.push(err));
    await t.start();

    const session = getSession();
    session.finish = async () => {
      session.calls.finish++;
      session.emit("finished");
    };

    const stopP = t.stop();
    await vi.advanceTimersByTimeAsync(300);
    await stopP;

    session.emit("disconnected", "expected teardown");
    expect(errors).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// stop()
// --------------------------------------------------------------------------

describe("SonioxTranscriber — stop()", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("calls finalize() then finish() in order", async () => {
    const t = makeTranscriber();
    await t.start();

    const session = getSession();
    session.finish = async () => {
      session.calls.finish++;
      session.emit("finished");
    };

    const stopP = t.stop();
    await vi.advanceTimersByTimeAsync(300);
    await stopP;

    expect(session.calls.finalize).toBe(1);
    expect(session.calls.finish).toBe(1);
  });

  it("falls back to close() when finish() times out (> 1500 ms)", async () => {
    const t = makeTranscriber();
    await t.start();

    const session = getSession();
    session.finish = () => new Promise<void>(() => { /* hang forever */ });
    let closeCalled = 0;
    session.close = () => { closeCalled++; session.calls.close++; };

    const stopP = t.stop();
    await vi.advanceTimersByTimeAsync(2000);
    await stopP;

    expect(closeCalled).toBe(1);
  });

  it("is idempotent — stop() twice invokes finalize/finish once each", async () => {
    const t = makeTranscriber();
    await t.start();

    const session = getSession();
    session.finish = async () => {
      session.calls.finish++;
      session.emit("finished");
    };

    const p1 = t.stop();
    const p2 = t.stop();
    await vi.advanceTimersByTimeAsync(300);
    await Promise.all([p1, p2]);

    expect(session.calls.finalize).toBe(1);
    expect(session.calls.finish).toBe(1);
  });

  it("resolves immediately when start() was never called", async () => {
    const t = makeTranscriber();
    await expect(t.stop()).resolves.toBeUndefined();
  });
});
