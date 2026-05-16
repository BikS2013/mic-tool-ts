/**
 * Unit C — Soniox real-time STT client wrapper.
 *
 * Adapts the `@soniox/node` v2 SDK (`SonioxNodeClient` / `RealtimeSttSession`)
 * to the CLI's narrower {@link Transcriber} interface. Every SDK error class is
 * mapped to a typed {@link MicToolError} subclass before it crosses this
 * wrapper's boundary so callers never see raw SDK errors.
 *
 * Architectural notes (see docs/design/project-design.md §6):
 *   - The wrapper owns the SDK objects; callers never see them.
 *   - `<end>` and `<fin>` marker tokens are filtered before reaching callbacks.
 *   - Non-final tokens accumulate into `partialBuffer`; final tokens promote
 *     the buffer to `onFinal` and reset.
 *   - `sendAudio()` is guarded by `session.state === "connected"`; any
 *     synchronous SDK error during a send is routed through `onError` rather
 *     than allowed to crash the process.
 *   - Graceful shutdown: `finalize()` -> short drain -> `finish()` with a
 *     1500 ms race to `close()`.
 */

import {
  AbortError,
  AuthError,
  BadRequestError,
  ConnectionError,
  NetworkError,
  QuotaError,
  RealtimeError,
  SonioxNodeClient,
  StateError,
  type RealtimeResult,
  type RealtimeSttSession,
  type SttSessionConfig,
  type SttSessionOptions,
} from "@soniox/node";

import {
  MicToolError,
  SonioxAuthError,
  SonioxNetworkError,
  SonioxProtocolError,
} from "../errors.js";

export interface TranscriberOptions {
  /** Soniox API key. */
  apiKey: string;
  /** Soniox model (e.g. "stt-rt-v4"). */
  model: string;
  /** Soniox WebSocket endpoint (wss://...). */
  endpoint: string;
  /** Language hints: array of ISO 639-1/2 codes, OR ["auto"] for auto-detect. */
  languages: string[];
  /** Audio sample rate in Hz (must match what the mic source emits). */
  sampleRate: number;
  /** Whether to enable server-side endpoint detection. */
  enableEndpointDetection: boolean;
  /** When true, the wrapper emits diagnostic events to stderr. */
  verbose: boolean;
}

export interface Transcriber {
  /** Open the WebSocket session. Throws {@link SonioxAuthError} or
   *  {@link SonioxNetworkError} on failure. */
  start(): Promise<void>;
  /** Forward a chunk of PCM s16le audio to the live session. No-op if not
   *  connected. */
  pushAudio(chunk: Buffer): void;
  /** Gracefully finalize and close the session (bounded by an internal
   *  timeout). Idempotent. */
  stop(): Promise<void>;
  /** Register a partial-transcript callback. */
  onPartial(cb: (text: string) => void): void;
  /** Register a final-transcript callback. */
  onFinal(cb: (text: string) => void): void;
  /** Register a mid-stream error callback. */
  onError(cb: (err: Error) => void): void;
}

/** Bounded delay between `finalize()` and `finish()` (ms). Gives the server a
 *  brief window to flush pending non-final tokens as finals before we send
 *  EOS. Held well below the AC-8 1500 ms shutdown budget. */
const FINALIZE_DRAIN_MS = 250;

/** Maximum time to wait for `finish()` to drain before falling back to
 *  `close()`. Together with FINALIZE_DRAIN_MS this stays under AC-8's 1500 ms
 *  shutdown budget. */
const FINISH_TIMEOUT_MS = 1500;

/** Default SDK `connect_timeout_ms` is 20000; override to 5000 so AC-10
 *  network-failure paths fail fast. */
const CONNECT_TIMEOUT_MS = 5000;

/** Marker tokens emitted by the Soniox server that must not be surfaced as
 *  transcript text. */
const MARKER_END = "<end>";
const MARKER_FIN = "<fin>";

export class SonioxTranscriber implements Transcriber {
  private readonly opts: TranscriberOptions;
  private client: SonioxNodeClient | undefined;
  private session: RealtimeSttSession | undefined;

  private partialCb: ((text: string) => void) | undefined;
  private finalCb: ((text: string) => void) | undefined;
  private errorCb: ((err: Error) => void) | undefined;

  /**
   * Text of tokens that have been finalized within the *current* utterance
   * (since the last `onFinal` commit). Soniox does NOT re-send finalized
   * tokens in subsequent results, so we must accumulate them ourselves to
   * preserve the running transcript across results.
   */
  private committedFinals = "";

  /** True once `stop()` has been initiated; gates disconnect-error suppression
   *  and prevents repeated finalize/finish invocations. */
  private shuttingDown = false;

  /** Resolver for the promise returned by `stop()`. The persistent
   *  `'finished'` and `'disconnected'` handlers settle it. */
  private finishResolver: (() => void) | undefined;

  /** Captures a pre-connect `'error'` event so the auth/connect failure is
   *  rejected from `start()` even when the SDK delivers the error via the
   *  event channel rather than the thrown-from-connect() channel. */
  private preConnectError: MicToolError | undefined;

  constructor(opts: TranscriberOptions) {
    this.opts = opts;
  }

  // ---------------------------------------------------------------- lifecycle

  async start(): Promise<void> {
    if (this.session !== undefined) {
      // Reusing a transcriber is not part of the contract; keep the message
      // explicit so a future regression surfaces immediately.
      throw new SonioxProtocolError(
        "SonioxTranscriber.start() called more than once",
      );
    }

    this.client = new SonioxNodeClient({
      api_key: this.opts.apiKey,
      realtime: { ws_base_url: this.opts.endpoint },
    });

    const isAuto =
      this.opts.languages.length === 1 && this.opts.languages[0] === "auto";
    const sessionConfig: SttSessionConfig = {
      model: this.opts.model,
      audio_format: "pcm_s16le",
      sample_rate: this.opts.sampleRate,
      num_channels: 1,
      enable_endpoint_detection: this.opts.enableEndpointDetection,
      ...(isAuto
        ? { enable_language_identification: true }
        : { language_hints: this.opts.languages }),
    };

    const sessionOptions: SttSessionOptions = {
      connect_timeout_ms: CONNECT_TIMEOUT_MS,
    };

    this.session = this.client.realtime.stt(sessionConfig, sessionOptions);

    // Attach a one-shot pre-connect 'error' listener BEFORE connect() so an
    // event-channel-delivered auth/network error is captured rather than
    // thrown as an unhandled Node error.
    const preConnectErrorListener = (err: Error): void => {
      this.preConnectError = this.mapSdkError(err);
      if (this.opts.verbose) {
        process.stderr.write(
          `[mic-tool] soniox pre-connect error: ${err.message}\n`,
        );
      }
    };
    this.session.once("error", preConnectErrorListener);

    // Wire the data-path events BEFORE connect() so we never miss a result
    // that arrives during/immediately after the handshake.
    this.wireDataEvents();

    if (this.opts.verbose) {
      process.stderr.write(
        `[mic-tool] soniox: connecting (model=${this.opts.model}, languages=[${this.opts.languages.join(", ")}])\n`,
      );
    }

    try {
      await this.session.connect();
    } catch (err) {
      // Drop the pre-connect listener — connect() itself reported the error.
      this.session.off("error", preConnectErrorListener);
      throw this.mapSdkError(err);
    }

    // connect() resolved. Promote the pre-connect listener: if it fired
    // during the handshake, surface its captured error.
    this.session.off("error", preConnectErrorListener);
    if (this.preConnectError !== undefined) {
      const captured = this.preConnectError;
      this.preConnectError = undefined;
      throw captured;
    }

    if (this.opts.verbose) {
      process.stderr.write("[mic-tool] soniox: connected\n");
    }

    // Install the persistent mid-stream 'error' listener.
    this.session.on("error", (err: Error) => {
      if (this.opts.verbose) {
        process.stderr.write(
          `[mic-tool] soniox mid-stream error: ${err.message}\n`,
        );
      }
      const mapped = this.mapSdkError(err);
      this.dispatchError(mapped);
    });
  }

  pushAudio(chunk: Buffer): void {
    const session = this.session;
    if (session === undefined || session.state !== "connected") {
      if (this.opts.verbose) {
        process.stderr.write(
          `[mic-tool] dropped ${chunk.length} audio bytes (session state=${
            session?.state ?? "uninitialised"
          })\n`,
        );
      }
      return;
    }
    try {
      // Buffer is a Uint8Array subclass; the SDK accepts it directly.
      session.sendAudio(chunk);
    } catch (err) {
      // Synchronous SDK error (e.g. StateError if state flipped between the
      // guard and the send). Never let it crash the process — route through
      // the error callback after mapping.
      const mapped = this.mapSdkError(err);
      if (this.opts.verbose) {
        process.stderr.write(
          `[mic-tool] sendAudio threw synchronously: ${mapped.message}\n`,
        );
      }
      this.dispatchError(mapped);
    }
  }

  async stop(): Promise<void> {
    if (this.shuttingDown) {
      // Idempotent: a second caller awaits the same in-flight shutdown.
      if (this.finishResolver === undefined) return;
      return new Promise<void>((resolve) => {
        const prev = this.finishResolver;
        this.finishResolver = () => {
          prev?.();
          resolve();
        };
      });
    }
    this.shuttingDown = true;

    const session = this.session;
    if (session === undefined) return;

    // If the session was never connected (or already torn down), nothing to
    // drain. Force-close defensively and return.
    if (session.state !== "connected" && session.state !== "finishing") {
      try {
        session.close();
      } catch {
        /* ignore — already closed */
      }
      return;
    }

    // Ask the server to flush pending non-final tokens as finals first.
    if (this.opts.verbose) {
      process.stderr.write("[mic-tool] soniox: finalize()\n");
    }
    try {
      session.finalize();
    } catch {
      /* fire-and-forget; finish() below will report any persistent issue */
    }

    // Brief drain window for the finals to arrive before EOS.
    await delay(FINALIZE_DRAIN_MS);

    if (this.opts.verbose) {
      process.stderr.write("[mic-tool] soniox: finish()\n");
    }
    try {
      await Promise.race([
        session.finish(),
        rejectAfter(
          FINISH_TIMEOUT_MS,
          new Error(`soniox finish() exceeded ${FINISH_TIMEOUT_MS}ms`),
        ),
      ]);
    } catch (err) {
      // finish() rejected or timed out — force-close.
      if (this.opts.verbose) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          `[mic-tool] soniox: finish() failed (${msg}); calling close()\n`,
        );
      }
      try {
        session.close();
      } catch {
        /* ignore — best-effort */
      }
    }
  }

  // ---------------------------------------------------------------- callbacks

  onPartial(cb: (text: string) => void): void {
    this.partialCb = cb;
  }

  onFinal(cb: (text: string) => void): void {
    this.finalCb = cb;
  }

  onError(cb: (err: Error) => void): void {
    this.errorCb = cb;
  }

  // ---------------------------------------------------------------- internals

  /**
   * Token-level event wiring.
   *
   * We use the SDK's `'result'` event as the single source of truth (the SDK
   * also emits a per-token `'token'` event for convenience; consuming both
   * would cause duplicates). Each `'result'` payload may mix `is_final`
   * tokens and non-final tokens — per the SDK research §4 finality model.
   *
   * Algorithm (see project-design.md §6.5):
   *   - Drop `<end>` / `<fin>` marker tokens entirely.
   *   - Concatenate non-final tokens into `partialBuffer`; emit
   *     `onPartial(partialBuffer)` whenever it is non-empty after a result.
   *   - When a `'result'` carries any final tokens, emit
   *     `onFinal((finals + partialBuffer).trim())` and reset the buffer.
   */
  private wireDataEvents(): void {
    const session = this.session;
    if (session === undefined) return;

    session.on("result", (result: RealtimeResult) => {
      this.handleResult(result);
    });

    // Server-side semantic endpoint marker. We don't surface this as a
    // separate callback in the v1 stub interface; the partial->final promotion
    // in handleResult() already covers utterance commit. Just log under
    // verbose for diagnostics.
    session.on("endpoint", () => {
      if (this.opts.verbose) {
        process.stderr.write("[mic-tool] soniox: endpoint\n");
      }
      // Endpoint signals utterance completion. Commit any accumulated finals
      // as a single line and reset for the next utterance.
      if (this.committedFinals.trim().length > 0) {
        const text = this.committedFinals.trim();
        this.committedFinals = "";
        this.finalCb?.(text);
      }
    });

    session.on("finalized", () => {
      if (this.opts.verbose) {
        process.stderr.write("[mic-tool] soniox: finalized\n");
      }
      // Flush any committed finals that did not produce an endpoint.
      if (this.committedFinals.trim().length > 0) {
        const text = this.committedFinals.trim();
        this.committedFinals = "";
        this.finalCb?.(text);
      }
    });

    session.on("finished", () => {
      if (this.opts.verbose) {
        process.stderr.write("[mic-tool] soniox: finished\n");
      }
      this.settleFinish();
    });

    session.on("disconnected", (reason?: string) => {
      if (this.opts.verbose) {
        process.stderr.write(
          `[mic-tool] soniox: disconnected${reason !== undefined ? ` (${reason})` : ""}\n`,
        );
      }
      if (this.shuttingDown) {
        // Expected — caller invoked stop().
        this.settleFinish();
        return;
      }
      // Unsolicited disconnect — treat as a network error so the orchestrator
      // can map it to exit code 5 (SONIOX_NETWORK).
      const detail = reason !== undefined && reason.length > 0
        ? `Soniox connection lost: ${reason}`
        : "Soniox connection lost (server closed the WebSocket)";
      this.dispatchError(new SonioxNetworkError(detail));
    });
  }

  private handleResult(result: RealtimeResult): void {
    // Soniox delivers the FULL current snapshot of non-final tokens in each
    // result (they are not cumulative across results) while final tokens
    // appear once and are dropped from subsequent results. Therefore:
    //   - Finals are appended to the running `committedFinals` buffer.
    //   - Non-finals are rebuilt from scratch per result.
    //   - The displayed partial is `committedFinals + currentNonFinals`.
    //   - The endpoint event (or finalized event) commits `committedFinals`
    //     as a final and clears the buffer.

    let newFinals = "";
    let currentNonFinals = "";

    for (const tok of result.tokens) {
      if (tok.text === MARKER_END || tok.text === MARKER_FIN) continue;
      if (tok.is_final) {
        newFinals += tok.text;
      } else {
        currentNonFinals += tok.text;
      }
    }

    if (newFinals.length > 0) {
      this.committedFinals += newFinals;
    }

    const display = this.committedFinals + currentNonFinals;
    if (display.length > 0 && this.partialCb !== undefined) {
      this.partialCb(display);
    }
  }

  /** Map any SDK error to one of the project's typed errors. */
  private mapSdkError(err: unknown): MicToolError {
    if (err instanceof MicToolError) return err;

    const msg = err instanceof Error ? err.message : String(err);

    if (err instanceof AuthError) {
      return new SonioxAuthError(
        `Soniox authentication failed: ${msg}`,
        { cause: err },
      );
    }
    if (err instanceof NetworkError || err instanceof ConnectionError) {
      return new SonioxNetworkError(msg, { cause: err });
    }
    if (err instanceof BadRequestError || err instanceof QuotaError) {
      return new SonioxProtocolError(msg, { cause: err });
    }
    if (
      err instanceof AbortError ||
      err instanceof StateError ||
      err instanceof RealtimeError
    ) {
      return new SonioxProtocolError(msg, { cause: err });
    }
    return new SonioxProtocolError(
      `unexpected Soniox error: ${msg}`,
      { cause: err instanceof Error ? err : undefined },
    );
  }

  /** Forward an already-mapped error to the registered callback. If no
   *  callback is set the error is silently dropped (the orchestrator wires
   *  the callback during start() so this is only reachable in tests). */
  private dispatchError(err: Error): void {
    if (this.errorCb !== undefined) {
      try {
        this.errorCb(err);
      } catch (cbErr) {
        // A throwing user callback must not propagate back into the SDK
        // emitter. Log under verbose and drop.
        if (this.opts.verbose) {
          const msg = cbErr instanceof Error ? cbErr.message : String(cbErr);
          process.stderr.write(`[mic-tool] onError callback threw: ${msg}\n`);
        }
      }
    }
  }

  /** Resolve the pending `stop()` promise (if any). Idempotent. */
  private settleFinish(): void {
    const resolver = this.finishResolver;
    if (resolver !== undefined) {
      this.finishResolver = undefined;
      resolver();
    }
  }
}

// --------------------------------------------------------------------- helpers

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function rejectAfter(ms: number, err: Error): Promise<never> {
  return new Promise<never>((_, reject) => setTimeout(() => reject(err), ms));
}
