/**
 * Unit tests for the ElevenLabs realtime STT adapter.
 *
 * The `ws` package is mocked so no network connection is made.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventEmitter } from "node:events";

vi.mock("ws", async () => {
  const { EventEmitter } = await import("node:events");

  class FakeWebSocket extends EventEmitter {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    readyState = FakeWebSocket.CONNECTING;
    sent: string[] = [];
    readonly url: string;
    readonly options: unknown;
    terminated = false;

    constructor(url: string, options: unknown) {
      super();
      this.url = url;
      this.options = options;
      (globalThis as Record<string, unknown>).__currentElevenLabsWs = this;
    }

    send(data: string) {
      this.sent.push(data);
    }

    close(code?: number, reason?: string) {
      this.readyState = FakeWebSocket.CLOSED;
      this.emit("close", code ?? 1000, Buffer.from(reason ?? ""));
    }

    terminate() {
      this.terminated = true;
      this.readyState = FakeWebSocket.CLOSED;
    }

    open() {
      this.readyState = FakeWebSocket.OPEN;
      this.emit("open");
    }

    message(value: unknown) {
      this.emit("message", Buffer.from(JSON.stringify(value)));
    }
  }

  return { default: FakeWebSocket };
});

import { ElevenLabsTranscriber } from "../src/elevenlabs/client.js";
import {
  ElevenLabsAuthError,
  ElevenLabsNetworkError,
  ElevenLabsProtocolError,
} from "../src/errors.js";

const g = globalThis as Record<string, unknown>;

interface FakeWsShape extends EventEmitter {
  readyState: number;
  sent: string[];
  url: string;
  options: { headers?: Record<string, string> };
  terminated: boolean;
  open(): void;
  message(value: unknown): void;
}

function getWs(): FakeWsShape {
  return g.__currentElevenLabsWs as FakeWsShape;
}

function makeTranscriber(opts?: {
  languages?: string[];
  sampleRate?: number;
  enableEndpointDetection?: boolean;
}) {
  return new ElevenLabsTranscriber({
    provider: "elevenlabs",
    apiKey: "xi_test",
    model: "scribe_v2_realtime",
    endpoint: "wss://api.elevenlabs.io/v1/speech-to-text/realtime",
    languages: opts?.languages ?? ["auto"],
    sampleRate: opts?.sampleRate ?? 16000,
    enableEndpointDetection: opts?.enableEndpointDetection ?? true,
    verbose: false,
  });
}

describe("ElevenLabsTranscriber — start()", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("opens the realtime URL with query params and xi-api-key header", async () => {
    const t = makeTranscriber({ languages: ["en"], sampleRate: 24000 });
    const startP = t.start();
    const ws = getWs();
    ws.open();
    await startP;

    const url = new URL(ws.url);
    expect(url.origin + url.pathname).toBe(
      "wss://api.elevenlabs.io/v1/speech-to-text/realtime",
    );
    expect(url.searchParams.get("model_id")).toBe("scribe_v2_realtime");
    expect(url.searchParams.get("audio_format")).toBe("pcm_24000");
    expect(url.searchParams.get("sample_rate")).toBe("24000");
    expect(url.searchParams.get("commit_strategy")).toBe("vad");
    expect(url.searchParams.get("language_code")).toBe("en");
    expect(ws.options.headers?.["xi-api-key"]).toBe("xi_test");
  });

  it("uses manual commit strategy when endpoint detection is disabled", async () => {
    const t = makeTranscriber({ enableEndpointDetection: false });
    const startP = t.start();
    getWs().open();
    await startP;

    expect(new URL(getWs().url).searchParams.get("commit_strategy")).toBe(
      "manual",
    );
  });
});

describe("ElevenLabsTranscriber — audio and events", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends base64 PCM chunks as input_audio_chunk messages", async () => {
    const t = makeTranscriber();
    const startP = t.start();
    const ws = getWs();
    ws.open();
    await startP;

    t.pushAudio(Buffer.from([1, 2, 3]));

    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0]!)).toEqual({
      message_type: "input_audio_chunk",
      audio_base_64: "AQID",
      sample_rate: 16000,
    });
  });

  it("emits partial and committed transcripts", async () => {
    const t = makeTranscriber();
    const partials: string[] = [];
    const finals: string[] = [];
    t.onPartial((text) => partials.push(text));
    t.onFinal((text) => finals.push(text));

    const startP = t.start();
    const ws = getWs();
    ws.open();
    await startP;

    ws.message({ message_type: "partial_transcript", text: "hel" });
    ws.message({ message_type: "committed_transcript", text: "hello " });

    expect(partials).toEqual(["hel"]);
    expect(finals).toEqual(["hello"]);
  });

  it("maps server auth errors to ElevenLabsAuthError", async () => {
    const t = makeTranscriber();
    const errors: Error[] = [];
    t.onError((err) => errors.push(err));

    const startP = t.start();
    const ws = getWs();
    ws.open();
    await startP;

    ws.message({
      message_type: "error",
      error_type: "auth_error",
      message: "bad key",
    });

    expect(errors[0]).toBeInstanceOf(ElevenLabsAuthError);
  });

  it("maps unexpected close after connect to ElevenLabsNetworkError", async () => {
    const t = makeTranscriber();
    const errors: Error[] = [];
    t.onError((err) => errors.push(err));

    const startP = t.start();
    const ws = getWs();
    ws.open();
    await startP;

    ws.emit("close", 1006, Buffer.from("lost"));
    expect(errors[0]).toBeInstanceOf(ElevenLabsNetworkError);
  });

  it("maps non-JSON messages to ElevenLabsProtocolError", async () => {
    const t = makeTranscriber();
    const errors: Error[] = [];
    t.onError((err) => errors.push(err));

    const startP = t.start();
    const ws = getWs();
    ws.open();
    await startP;

    ws.emit("message", Buffer.from("not json"));
    expect(errors[0]).toBeInstanceOf(ElevenLabsProtocolError);
  });

  it("sends a final commit message on stop", async () => {
    const t = makeTranscriber();
    const startP = t.start();
    const ws = getWs();
    ws.open();
    await startP;

    await t.stop();

    expect(JSON.parse(ws.sent[0]!)).toEqual({
      message_type: "input_audio_chunk",
      audio_base_64: "",
      sample_rate: 16000,
      commit: true,
    });
  });
});
