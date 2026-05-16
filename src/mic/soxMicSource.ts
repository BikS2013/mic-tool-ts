/**
 * Unit B — macOS `sox` implementation of {@link MicSource}.
 *
 * Spawns the `sox` binary with arguments that produce raw `pcm_s16le` mono
 * audio at 16 kHz on stdout. The child's stdout is piped into a
 * {@link PassThrough} so that callers see a stable {@link Readable} reference
 * for the entire lifetime of the {@link SoxMicSource} instance, regardless of
 * the child-process lifecycle.
 *
 * Error mapping (per docs/design/project-design.md §5):
 *  - `ENOENT` from `spawn` → {@link MicNotAvailableError} (sox not installed).
 *  - Early exit with `coreaudio` / `permission` / `not allowed` in stderr →
 *    {@link MicPermissionDeniedError}.
 *  - Early exit with `can't open` / `no default audio device` in stderr →
 *    {@link MicNotAvailableError}.
 *  - Any other early exit → {@link MicNotAvailableError} carrying the stderr
 *    tail for diagnostics.
 *  - Unexpected exit while running → `'error'` event on the {@link audio}
 *    stream carrying a {@link MicNotAvailableError}.
 */

import { spawn, type ChildProcessByStdio } from "node:child_process";
import { PassThrough, type Readable } from "node:stream";
import {
  MicNotAvailableError,
  MicPermissionDeniedError,
} from "../errors.js";
import type { MicSource } from "./types.js";

/** Locked spawn argv (see project-design.md §5.1). */
const SOX_ARGS = [
  "-q",
  "-d",
  "-t",
  "raw",
  "-r",
  "16000",
  "-c",
  "1",
  "-b",
  "16",
  "-e",
  "signed-integer",
  "-L",
  "-",
] as const;

/** Rolling stderr tail size — 4 KB is plenty for sox error messages. */
const STDERR_TAIL_BYTES = 4096;

/** Window after which we consider `start()` to have succeeded. */
const START_GRACE_MS = 200;

/** Time we wait for SIGTERM to take effect before sending SIGKILL. */
const STOP_GRACE_MS = 500;

/** Concrete child-process subtype produced by our `stdio: ['ignore','pipe','pipe']` spawn. */
type SoxChild = ChildProcessByStdio<null, Readable, Readable>;

export interface SoxMicSourceOptions {
  /** When true, emit diagnostic lines to `process.stderr`. */
  readonly verbose?: boolean;
}

type State = "idle" | "starting" | "running" | "stopping" | "stopped";

export class SoxMicSource implements MicSource {
  /** Public PCM stream — stable reference for the lifetime of this instance. */
  public readonly audio: Readable;

  private readonly verbose: boolean;
  private readonly passthrough: PassThrough;
  private child: SoxChild | undefined;
  private stderrTail = "";
  private state: State = "idle";
  /** True when stop() has initiated child termination, so we can distinguish
   *  "expected exit" from "unexpected exit". */
  private intentionalStop = false;
  /** Resolved by stop() when the child has exited. */
  private exitWaiters: Array<() => void> = [];

  constructor(options: SoxMicSourceOptions = {}) {
    this.verbose = options.verbose === true;
    this.passthrough = new PassThrough();
    // Public field is the PassThrough — consumers attach 'data' / 'end' / 'error'
    // listeners here, and we control when it ends.
    this.audio = this.passthrough;
  }

  async start(): Promise<void> {
    if (this.state !== "idle") {
      throw new Error("SoxMicSource already started");
    }
    this.state = "starting";

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let graceTimer: NodeJS.Timeout | undefined;

      const settle = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        if (graceTimer !== undefined) {
          clearTimeout(graceTimer);
          graceTimer = undefined;
        }
        fn();
      };

      let child: SoxChild;
      try {
        child = spawn("sox", [...SOX_ARGS], {
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (err) {
        // spawn() itself rarely throws (errors normally arrive via 'error'),
        // but TS types allow it. Treat as ENOENT-like failure.
        this.state = "stopped";
        const message = err instanceof Error ? err.message : String(err);
        reject(
          new MicNotAvailableError(
            `Failed to spawn sox: ${message}`,
            { cause: err },
          ),
        );
        return;
      }

      this.child = child;

      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        this.stderrTail = (this.stderrTail + text).slice(-STDERR_TAIL_BYTES);
      });

      child.on("error", (err: NodeJS.ErrnoException) => {
        // 'error' on the child can fire either before 'spawn' (e.g. ENOENT) or
        // mid-stream (e.g. EPIPE). Only the pre-resolve case rejects start().
        if (!settled) {
          this.state = "stopped";
          if (err.code === "ENOENT") {
            settle(() =>
              reject(
                new MicNotAvailableError(
                  "sox not installed. Install with: brew install sox",
                  { cause: err },
                ),
              ),
            );
          } else {
            settle(() =>
              reject(
                new MicNotAvailableError(
                  `Failed to spawn sox: ${err.message}`,
                  { cause: err },
                ),
              ),
            );
          }
          return;
        }
        // Mid-stream: surface on the audio stream.
        this.passthrough.emit(
          "error",
          new MicNotAvailableError(
            `sox child-process error: ${err.message}`,
            { cause: err },
          ),
        );
      });

      child.on("exit", (code, signal) => {
        // Drain any waiters parked in stop().
        const waiters = this.exitWaiters;
        this.exitWaiters = [];
        for (const w of waiters) w();

        if (!settled) {
          // Exit during startup: classify from stderr tail.
          this.state = "stopped";
          settle(() => reject(this.classifyStartupExit(code, signal)));
          // Ensure the PassThrough doesn't hang the consumer.
          if (!this.passthrough.writableEnded) this.passthrough.end();
          return;
        }
        // Exit after we resolved start().
        const wasIntentional = this.intentionalStop;
        this.state = "stopped";
        if (!this.passthrough.writableEnded) this.passthrough.end();
        if (this.verbose) {
          process.stderr.write("[mic-tool] sox stopped\n");
        }
        if (!wasIntentional) {
          // Unexpected: signal the orchestrator via 'error' on audio.
          const tail = this.stderrTail.trim();
          const detail = tail.length > 0 ? tail : `code=${code} signal=${signal ?? "none"}`;
          this.passthrough.emit(
            "error",
            new MicNotAvailableError(
              `microphone capture ended unexpectedly: ${detail}`,
            ),
          );
        }
      });

      // Pipe stdout into the public PassThrough WITHOUT auto-ending it —
      // we control end-of-stream explicitly in the 'exit' handler so consumers
      // see EOF only once stop() (or unexpected exit) has fully run.
      child.stdout.pipe(this.passthrough, { end: false });
      // If stdout ends but the child somehow stays alive, propagate by
      // closing the PassThrough on the next 'exit' (handled above). We do
      // NOT end the PassThrough on stdout's 'end' here because the 'exit'
      // path is the single source of truth for stream completion.

      // Treat survival past START_GRACE_MS as a successful start.
      graceTimer = setTimeout(() => {
        if (settled) return;
        this.state = "running";
        if (this.verbose) {
          process.stderr.write(`[mic-tool] sox started (pid=${child.pid})\n`);
        }
        settle(() => resolve());
      }, START_GRACE_MS);
    });
  }

  async stop(): Promise<void> {
    if (this.state === "idle" || this.state === "stopped") {
      return;
    }
    if (this.state === "stopping") {
      // Already stopping — wait for the same exit event.
      await new Promise<void>((resolve) => {
        this.exitWaiters.push(resolve);
      });
      return;
    }

    this.state = "stopping";
    this.intentionalStop = true;
    const child = this.child;
    if (child === undefined || child.exitCode !== null) {
      // No live child to terminate.
      this.state = "stopped";
      if (!this.passthrough.writableEnded) this.passthrough.end();
      return;
    }

    await new Promise<void>((resolve) => {
      this.exitWaiters.push(resolve);
      const killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          try {
            child.kill("SIGKILL");
          } catch {
            /* already dead */
          }
        }
      }, STOP_GRACE_MS);
      // Clear the SIGKILL timer once the child exits.
      this.exitWaiters.push(() => clearTimeout(killTimer));
      try {
        child.kill("SIGTERM");
      } catch {
        // child may already be dead; resolve via the eventual exit handler
        // (or immediately if none will fire).
        if (child.exitCode !== null) {
          const waiters = this.exitWaiters;
          this.exitWaiters = [];
          for (const w of waiters) w();
        }
      }
    });

    if (!this.passthrough.writableEnded) this.passthrough.end();
  }

  /**
   * Inspect the buffered stderr tail and map a non-zero exit during startup
   * to the most informative typed error.
   */
  private classifyStartupExit(
    code: number | null,
    signal: NodeJS.Signals | null,
  ): MicNotAvailableError | MicPermissionDeniedError {
    const tail = this.stderrTail;
    const lower = tail.toLowerCase();
    const mentionsCoreAudio = lower.includes("coreaudio");
    const mentionsDevice = lower.includes("device");
    const mentionsPermission =
      lower.includes("not allowed") ||
      lower.includes("permission") ||
      lower.includes("not authorized");
    const mentionsCantOpen =
      lower.includes("can't open") ||
      lower.includes("cannot open") ||
      lower.includes("no default audio device");

    if ((mentionsCoreAudio && mentionsDevice) || mentionsPermission) {
      return new MicPermissionDeniedError(
        "Microphone access denied. Grant access in System Settings > Privacy & Security > Microphone, then re-run.",
      );
    }
    if (mentionsCantOpen) {
      return new MicNotAvailableError(
        "No default audio input device. Connect a microphone and try again.",
      );
    }
    const detail = tail.trim().length > 0
      ? tail.trim()
      : `code=${code} signal=${signal ?? "none"}`;
    return new MicNotAvailableError(`sox exited unexpectedly: ${detail}`);
  }
}
