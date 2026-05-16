/**
 * Unit D — Stdout renderer.
 *
 * Renders partial and final transcript text to a `NodeJS.WritableStream`
 * (defaults to `process.stdout`) according to one of three output modes:
 *
 *   - "overwrite"  — partials overlay the current line via `\r`; finals
 *                    terminate the line with `\n`. The default for TTYs.
 *   - "append"     — every partial and every final is written as its own
 *                    `\n`-terminated line. No carriage returns. Pipe-safe.
 *   - "final-only" — partials are dropped; only finals produce a line.
 *                    Pipe-safe.
 *
 * TTY auto-downgrade: if `opts.isTTY === false` AND `opts.mode === "overwrite"`,
 * the renderer transparently downgrades to "append". `\r` carriage returns
 * inside a piped output file would produce visual artifacts (FR-4 / AC-12).
 * The downgrade applies regardless of whether "overwrite" came from the
 * default or from an explicit `--output-mode overwrite` flag.
 *
 * The renderer never throws. If the underlying `stdout.write` fails, the
 * error is allowed to surface to the orchestrator's top-level catch.
 */

import type { OutputMode } from "../config.js";

export interface Renderer {
  /** Render the latest partial transcript (in modes that show partials). */
  partial(text: string): void;
  /** Render a finalized utterance line. */
  final(text: string): void;
  /** Mark a turn boundary by emitting an empty line on the output. Called by
   *  the turn detector after the guard phrase commits a turn. */
  turnBoundary(): void;
  /** Render an LLM-refined version of the just-closed turn on its own line,
   *  followed by an additional blank line. Called when LLM refinement is
   *  enabled and the refine call succeeds. */
  refined(text: string): void;
  /** Flush any pending state and release resources. Idempotent. */
  dispose(): void;
}

export interface RendererOptions {
  /** Requested rendering mode. May be downgraded internally when `isTTY === false`. */
  mode: OutputMode;
  /** Whether stdout is attached to a TTY (controls use of `\r` and ANSI sequences). */
  isTTY: boolean;
}

/**
 * Concrete renderer that writes synchronously to a `NodeJS.WritableStream`.
 *
 * The `out` injection point exists primarily so unit tests can capture the
 * exact byte sequence without spawning a child process; in production code
 * the orchestrator passes `process.stdout` (the default).
 */
export class StdoutRenderer implements Renderer {
  private readonly out: NodeJS.WritableStream;
  private readonly isTTY: boolean;
  private readonly mode: OutputMode;
  /** Length (in characters) of the last text written in "overwrite" mode. */
  private prevLen = 0;
  /** Physical terminal rows occupied by the last overwrite-mode partial. */
  private prevRows = 0;
  /** Last partial snapshot rendered. Realtime STT providers can repeat an
   *  identical interim snapshot several times before finalizing it; rendering
   *  those repeats creates duplicate transcript-looking lines in append mode
   *  and noisy copied terminal output in overwrite mode. */
  private lastPartialText: string | null = null;
  private disposed = false;

  constructor(opts: RendererOptions & { out?: NodeJS.WritableStream }) {
    this.out = opts.out ?? process.stdout;
    this.isTTY = opts.isTTY;
    // TTY auto-downgrade: never write `\r` to a non-TTY destination.
    this.mode =
      opts.mode === "overwrite" && !opts.isTTY ? "append" : opts.mode;
  }

  /** Effective output mode after any TTY-driven downgrade. */
  get effectiveMode(): OutputMode {
    return this.mode;
  }

  partial(text: string): void {
    if (this.disposed) return;
    if (text === "") return; // edge case: never overwrite with blanks
    if (text === this.lastPartialText) return;
    this.lastPartialText = text;
    switch (this.mode) {
      case "overwrite": {
        const safe = sanitizeForOverwrite(text);
        const prefix = this.overwritePrefix();
        const safeLen = visibleLength(safe);
        const padding =
          this.prevRows <= 1 ? Math.max(0, this.prevLen - safeLen) : 0;
        this.out.write(prefix + safe + " ".repeat(padding));
        this.prevLen = safeLen;
        this.prevRows = this.rowsForText(safe);
        return;
      }
      case "append": {
        this.out.write(text + "\n");
        return;
      }
      case "final-only": {
        // Partials are intentionally suppressed.
        return;
      }
    }
  }

  final(text: string): void {
    if (this.disposed) return;
    this.lastPartialText = null;
    switch (this.mode) {
      case "overwrite": {
        const safe = sanitizeForOverwrite(text);
        const prefix = this.overwritePrefix();
        const safeLen = visibleLength(safe);
        const padding =
          this.prevRows <= 1 ? Math.max(0, this.prevLen - safeLen) : 0;
        this.out.write(prefix + safe + " ".repeat(padding) + "\n");
        this.prevLen = 0;
        this.prevRows = 0;
        return;
      }
      case "append": {
        this.out.write(text + "\n");
        return;
      }
      case "final-only": {
        this.out.write(text + "\n");
        return;
      }
    }
  }

  turnBoundary(): void {
    if (this.disposed) return;
    this.lastPartialText = null;
    // Emit a single blank line. The preceding final() already terminated its
    // line with "\n" (in all three modes), so one more "\n" produces the gap.
    this.out.write("\n");
  }

  refined(text: string): void {
    if (this.disposed) return;
    if (text.length === 0) return;
    this.lastPartialText = null;
    // Defensive in overwrite mode: if a partial of the NEXT turn has already
    // been written (prevLen > 0), commit it with "\n" first so the refined
    // output doesn't appear concatenated to the partial. The next partial
    // will start fresh.
    if (this.mode === "overwrite" && this.prevLen > 0) {
      this.out.write("\n");
      this.prevLen = 0;
      this.prevRows = 0;
    }
    // Render the refined text on its own line, then a blank line below.
    // No \r — refined output is committed content, identical across modes.
    this.out.write(text + "\n\n");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.lastPartialText = null;
    if (this.mode === "overwrite") {
      // Terminate any in-progress overwrite line so the shell prompt is clean.
      if (this.prevLen > 0) {
        this.out.write("\n");
        this.prevLen = 0;
        this.prevRows = 0;
      }
      // Emit ANSI clear-line + CR only on a real TTY. In the downgraded
      // (append) case this branch is unreachable, but the guard is kept
      // for defence-in-depth in case the mode is ever forced to overwrite
      // on a non-TTY by a future code path.
      if (this.isTTY) {
        this.out.write("\x1b[2K\r");
      }
    }
    // append / final-only: nothing to clean up.
  }

  private overwritePrefix(): string {
    if (this.prevRows <= 1) return "\r";

    const linesUp = this.prevRows - 1;
    let sequence = `\x1b[${linesUp}A\r`;
    for (let row = 0; row < this.prevRows; row += 1) {
      sequence += "\x1b[2K";
      if (row < this.prevRows - 1) {
        sequence += "\x1b[1B\r";
      }
    }
    return sequence + `\x1b[${linesUp}A\r`;
  }

  private rowsForText(text: string): number {
    const columns = terminalColumns(this.out);
    return Math.max(1, Math.ceil(visibleLength(text) / columns));
  }
}

/**
 * Strip characters that would corrupt the overwrite scheme. The Soniox SDK
 * is not expected to emit `\n` or `\r` inside a single token, but if it
 * ever does they would break the single-line invariant. Replace with a
 * single space so visible word boundaries are preserved.
 */
function sanitizeForOverwrite(text: string): string {
  if (text.indexOf("\n") === -1 && text.indexOf("\r") === -1) return text;
  return text.replace(/[\r\n]+/g, " ");
}

function visibleLength(text: string): number {
  return Array.from(text).length;
}

function terminalColumns(out: NodeJS.WritableStream): number {
  const outColumns = (out as { columns?: unknown }).columns;
  if (
    typeof outColumns === "number" &&
    Number.isFinite(outColumns) &&
    outColumns > 0
  ) {
    return Math.floor(outColumns);
  }

  const stdoutColumns = process.stdout.columns;
  if (
    typeof stdoutColumns === "number" &&
    Number.isFinite(stdoutColumns) &&
    stdoutColumns > 0
  ) {
    return Math.floor(stdoutColumns);
  }

  return 80;
}
