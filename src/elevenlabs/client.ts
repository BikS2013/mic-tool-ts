/**
 * ElevenLabs Scribe Realtime STT client.
 *
 * Uses the public WebSocket API directly instead of the ElevenLabs SDK because
 * `untype` already owns mic capture, chunking, lifecycle, and rendering.
 * The wrapper adapts ElevenLabs events to the provider-neutral Transcriber
 * contract used by the orchestrator.
 */

import WebSocket, { type RawData } from "ws";

import {
  ElevenLabsAuthError,
  ElevenLabsNetworkError,
  ElevenLabsProtocolError,
  MicToolError,
} from "../errors.js";
import type { Transcriber, TranscriberOptions } from "../transcription/types.js";

const CONNECT_TIMEOUT_MS = 5000;
const CLOSE_TIMEOUT_MS = 1500;
const COMMIT_DRAIN_MS = 250;

type State = "idle" | "connecting" | "connected" | "closing" | "closed";

type ElevenLabsIncoming =
  | { message_type: "session_started"; session_id?: string }
  | { message_type: "partial_transcript"; text?: string }
  | { message_type: "committed_transcript"; text?: string }
  | { message_type: "committed_transcript_with_timestamps"; text?: string }
  | {
      message_type: "error";
      error_type?: string;
      error?: string;
      message?: string;
      detail?: string;
    }
  | { message_type?: string; [key: string]: unknown };

export class ElevenLabsTranscriber implements Transcriber {
  private readonly opts: TranscriberOptions;
  private ws: WebSocket | undefined;
  private state: State = "idle";
  private shuttingDown = false;

  private partialCb: ((text: string) => void) | undefined;
  private finalCb: ((text: string) => void) | undefined;
  private errorCb: ((err: Error) => void) | undefined;

  constructor(opts: TranscriberOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    if (this.state !== "idle") {
      throw new ElevenLabsProtocolError(
        "ElevenLabsTranscriber.start() called more than once",
      );
    }

    this.state = "connecting";
    const url = buildRealtimeUrl(this.opts);

    if (this.opts.verbose) {
      process.stderr.write(
        `[untype] elevenlabs: connecting (model=${this.opts.model}, languages=[${this.opts.languages.join(", ")}])\n`,
      );
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        fn();
      };

      const connectTimer = setTimeout(() => {
        settle(() => {
          this.state = "closed";
          try {
            this.ws?.terminate();
          } catch {
            /* ignore */
          }
          reject(
            new ElevenLabsNetworkError(
              `ElevenLabs connection timed out after ${CONNECT_TIMEOUT_MS}ms`,
            ),
          );
        });
      }, CONNECT_TIMEOUT_MS);

      const ws = new WebSocket(url, {
        headers: { "xi-api-key": this.opts.apiKey },
      });
      this.ws = ws;

      const onPreError = (err: Error): void => {
        if (!settled) {
          settle(() => {
            this.state = "closed";
            reject(mapConnectionError(err));
          });
          return;
        }
        this.dispatchError(mapConnectionError(err));
      };
      const onPreClose = (code: number, reason: Buffer): void => {
        if (!settled) {
          settle(() => {
            this.state = "closed";
            reject(mapCloseError(code, reason));
          });
        }
      };

      ws.once("open", () => {
        settle(() => {
          ws.off("error", onPreError);
          ws.off("close", onPreClose);
          this.state = "connected";
          if (this.opts.verbose) {
            process.stderr.write("[untype] elevenlabs: connected\n");
          }
          resolve();
        });
      });

      ws.once("error", onPreError);
      ws.once("close", onPreClose);
    });

    this.wireRuntimeEvents();
  }

  pushAudio(chunk: Buffer): void {
    const ws = this.ws;
    if (ws === undefined || this.state !== "connected" || ws.readyState !== WebSocket.OPEN) {
      if (this.opts.verbose) {
        process.stderr.write(
          `[untype] dropped ${chunk.length} audio bytes (elevenlabs state=${this.state})\n`,
        );
      }
      return;
    }

    try {
      ws.send(
        JSON.stringify({
          message_type: "input_audio_chunk",
          audio_base_64: chunk.toString("base64"),
          sample_rate: this.opts.sampleRate,
        }),
      );
    } catch (err) {
      this.dispatchError(mapConnectionError(err));
    }
  }

  async commit(): Promise<void> {
    const ws = this.ws;
    if (ws === undefined || this.state !== "connected" || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      ws.send(
        JSON.stringify({
          message_type: "input_audio_chunk",
          audio_base_64: "",
          sample_rate: this.opts.sampleRate,
          commit: true,
        }),
      );
    } catch (err) {
      throw mapConnectionError(err);
    }

    await delay(COMMIT_DRAIN_MS);
  }

  async stop(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    const ws = this.ws;
    if (ws === undefined || this.state === "idle" || this.state === "closed") {
      this.state = "closed";
      return;
    }

    if (ws.readyState === WebSocket.OPEN) {
      const closePromise = new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          try {
            ws.terminate();
          } catch {
            /* ignore */
          }
          this.state = "closed";
          resolve();
        }, CLOSE_TIMEOUT_MS);

        ws.once("close", () => {
          clearTimeout(timer);
          this.state = "closed";
          resolve();
        });
      });

      try {
        await this.commit();
      } catch {
        /* best effort */
      }
      this.state = "closing";
      try {
        ws.close(1000, "untype shutdown");
      } catch {
        /* best effort */
      }
      await closePromise;
      return;
    } else {
      try {
        ws.terminate();
      } catch {
        /* ignore */
      }
      this.state = "closed";
      return;
    }
  }

  onPartial(cb: (text: string) => void): void {
    this.partialCb = cb;
  }

  onFinal(cb: (text: string) => void): void {
    this.finalCb = cb;
  }

  onError(cb: (err: Error) => void): void {
    this.errorCb = cb;
  }

  private wireRuntimeEvents(): void {
    const ws = this.ws;
    if (ws === undefined) return;

    ws.on("message", (data) => {
      this.handleMessage(data);
    });

    ws.on("error", (err) => {
      this.dispatchError(mapConnectionError(err));
    });

    ws.on("close", (code, reason) => {
      if (this.opts.verbose) {
        process.stderr.write(
          `[untype] elevenlabs: disconnected (code=${code})\n`,
        );
      }
      this.state = "closed";
      if (this.shuttingDown || code === 1000) return;
      this.dispatchError(mapCloseError(code, reason));
    });
  }

  private handleMessage(data: RawData): void {
    let parsed: ElevenLabsIncoming;
    try {
      parsed = JSON.parse(rawDataToString(data)) as ElevenLabsIncoming;
    } catch (err) {
      this.dispatchError(
        new ElevenLabsProtocolError("ElevenLabs returned non-JSON message", {
          cause: err,
        }),
      );
      return;
    }

    switch (parsed.message_type) {
      case "session_started":
        if (this.opts.verbose) {
          process.stderr.write(
            `[untype] elevenlabs: session_started${parsed.session_id !== undefined ? ` (${parsed.session_id})` : ""}\n`,
          );
        }
        return;
      case "partial_transcript":
        if (typeof parsed.text === "string" && parsed.text.length > 0) {
          this.partialCb?.(parsed.text);
        }
        return;
      case "committed_transcript":
      case "committed_transcript_with_timestamps":
        if (typeof parsed.text === "string" && parsed.text.trim().length > 0) {
          this.finalCb?.(parsed.text.trim());
        }
        return;
      case "error":
        this.dispatchError(
          mapServerError(parsed as Extract<ElevenLabsIncoming, { message_type: "error" }>),
        );
        return;
      default:
        if (this.opts.verbose) {
          process.stderr.write(
            `[untype] elevenlabs: ignored event ${String(parsed.message_type ?? "unknown")}\n`,
          );
        }
    }
  }

  private dispatchError(err: Error): void {
    if (this.errorCb === undefined) return;
    try {
      this.errorCb(err);
    } catch (cbErr) {
      if (this.opts.verbose) {
        const msg = cbErr instanceof Error ? cbErr.message : String(cbErr);
        process.stderr.write(`[untype] onError callback threw: ${msg}\n`);
      }
    }
  }
}

function buildRealtimeUrl(opts: TranscriberOptions): string {
  const url = new URL(opts.endpoint);
  url.searchParams.set("model_id", opts.model);
  url.searchParams.set("audio_format", `pcm_${opts.sampleRate}`);
  url.searchParams.set("sample_rate", String(opts.sampleRate));
  url.searchParams.set(
    "commit_strategy",
    opts.enableEndpointDetection ? "vad" : "manual",
  );
  url.searchParams.set("include_timestamps", "false");

  const isAuto = opts.languages.length === 1 && opts.languages[0] === "auto";
  if (!isAuto && opts.languages[0] !== undefined) {
    url.searchParams.set("language_code", opts.languages[0]);
  }
  return url.toString();
}

function rawDataToString(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  return Buffer.from(data).toString("utf8");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapConnectionError(err: unknown): MicToolError {
  if (err instanceof MicToolError) return err;
  const message = err instanceof Error ? err.message : String(err);
  if (/401|403|auth|unauthori[sz]ed|forbidden|api key/i.test(message)) {
    return new ElevenLabsAuthError(`ElevenLabs authentication failed: ${message}`, {
      cause: err,
    });
  }
  return new ElevenLabsNetworkError(message, {
    cause: err instanceof Error ? err : undefined,
  });
}

function mapCloseError(code: number, reason: Buffer): MicToolError {
  const reasonText = reason.toString("utf8");
  const detail = reasonText.length > 0 ? `${code} ${reasonText}` : String(code);
  if (code === 1008 || /auth|unauthori[sz]ed|forbidden|api key/i.test(reasonText)) {
    return new ElevenLabsAuthError(
      `ElevenLabs authentication failed or was rejected by policy: ${detail}`,
    );
  }
  return new ElevenLabsNetworkError(`ElevenLabs connection closed: ${detail}`);
}

function mapServerError(event: Extract<ElevenLabsIncoming, { message_type: "error" }>): MicToolError {
  const type = event.error_type ?? event.error ?? "error";
  const msg = event.message ?? event.detail ?? type;
  if (type === "auth_error" || /auth|unauthori[sz]ed|api key/i.test(msg)) {
    return new ElevenLabsAuthError(`ElevenLabs authentication failed: ${msg}`);
  }
  if (
    type === "quota_exceeded" ||
    type === "rate_limited" ||
    type === "resource_exhausted" ||
    type === "queue_overflow"
  ) {
    return new ElevenLabsProtocolError(`ElevenLabs ${type}: ${msg}`);
  }
  return new ElevenLabsProtocolError(`ElevenLabs ${type}: ${msg}`);
}
