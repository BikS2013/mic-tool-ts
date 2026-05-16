/**
 * Turn detector — guards each "turn" of dictation with a configurable phrase.
 *
 * Wraps a {@link Renderer} and watches finalized lines for a configured guard
 * phrase. When the phrase is detected anywhere inside the rolling buffer of
 * finals for the current turn, the wrapped renderer is asked to emit a turn
 * boundary (a blank line) and the buffer is reset.
 *
 * Matching is whitespace/case/accent insensitive: both the buffer and the
 * configured phrase are normalized through {@link normalizeForMatch} (NFD
 * decompose, strip combining marks, lowercase, collapse non-letter/non-digit
 * runs to a single space). This lets Greek phrases like "τέλος εντολής" match
 * "ΤΕΛΟΣ ΕΝΤΟΛΗΣ", "τελοσ εντολησ", or "τέλος εντολής." indifferently.
 *
 * The guard phrase is NOT stripped from the rendered final — the user wanted
 * to keep the trigger visible in the transcript.
 */

import type { Renderer } from "../render/renderer.js";
import type { LLMRefiner } from "../llm/types.js";
import { LLMRefinementError } from "../errors.js";

/** Maximum size of the rolling final-text buffer (in characters). Prevents
 *  unbounded growth on long turns; older finals naturally roll off. */
const MAX_BUFFER_CHARS = 2000;

export interface TurnAwareRenderer {
  partial(text: string): void;
  final(text: string): void;
  dispose(): void;
}

export interface TurnDetectorOptions {
  /** The guard phrase to listen for. Will be normalized before matching. */
  guardPhrase: string;
  /** When true, emits a diagnostic to stderr each time a turn boundary fires. */
  verbose?: boolean;
  /** Optional LLM refiner. When supplied, each closed turn's text (with the
   *  guard phrase stripped) is sent for refinement and the result is rendered
   *  via `renderer.refined()`. Failures are logged under verbose and skipped. */
  refiner?: LLMRefiner | null;
}

export class GuardPhraseTurnDetector implements TurnAwareRenderer {
  private readonly renderer: Renderer;
  private readonly normalizedGuard: string;
  private readonly guardPhraseRaw: string;
  private readonly verbose: boolean;
  private readonly refiner: LLMRefiner | null;

  /** Rolling concatenation of finalized text within the current turn. */
  private buffer = "";
  private disposed = false;

  constructor(renderer: Renderer, opts: TurnDetectorOptions) {
    this.renderer = renderer;
    this.guardPhraseRaw = opts.guardPhrase;
    this.normalizedGuard = normalizeForMatch(opts.guardPhrase);
    if (this.normalizedGuard.length === 0) {
      // The config layer also validates this; defending here in case the
      // detector is used outside the CLI entry point.
      throw new Error(
        "TurnDetector: guard phrase normalized to an empty string",
      );
    }
    this.verbose = opts.verbose ?? false;
    this.refiner = opts.refiner ?? null;
  }

  partial(text: string): void {
    this.renderer.partial(text);
  }

  final(text: string): void {
    this.renderer.final(text);

    this.buffer =
      this.buffer.length === 0 ? text : `${this.buffer} ${text}`;
    if (this.buffer.length > MAX_BUFFER_CHARS) {
      // Drop from the start; we only care about recent context for the match.
      this.buffer = this.buffer.slice(-MAX_BUFFER_CHARS);
    }

    if (normalizeForMatch(this.buffer).includes(this.normalizedGuard)) {
      if (this.verbose) {
        process.stderr.write("[mic-tool-ts] turn boundary detected\n");
      }
      // Capture the turn text BEFORE the reset for refinement.
      const turnText = this.buffer;
      this.buffer = "";
      this.renderer.turnBoundary();
      this.maybeRefine(turnText);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.refiner !== null) {
      try {
        this.refiner.dispose();
      } catch {
        /* best effort */
      }
    }
    this.renderer.dispose();
  }

  /**
   * Asynchronously refine the just-closed turn's text via the configured LLM
   * and render the result. Never awaited from `final()` — refinement happens
   * in the background so subsequent transcription is not blocked.
   *
   * Failure modes (auth, network, timeout, server, shape) are swallowed —
   * we log them under verbose and continue without a refined line. The user
   * still has the verbatim transcript above the blank line.
   */
  private maybeRefine(turnText: string): void {
    if (this.refiner === null) return;
    const stripped = stripGuardPhrase(turnText, this.guardPhraseRaw);
    if (stripped.length === 0) return; // nothing to refine
    const refiner = this.refiner;
    void (async () => {
      try {
        const refined = await refiner.refine(stripped);
        if (this.disposed) return; // dropped — shutting down
        if (refined.length > 0) {
          this.renderer.refined(refined);
        }
      } catch (err) {
        if (this.verbose) {
          const tag =
            err instanceof LLMRefinementError ? `llm-${err.kind}` : "llm";
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(`[mic-tool-ts] refinement failed (${tag}): ${msg}\n`);
        }
      }
    })();
  }
}

/**
 * Strip the guard phrase from a turn's text so the LLM only refines the
 * substantive content. We use normalized matching to find the phrase, but
 * remove the actual run of characters from the original (preserving the rest
 * of the turn intact).
 */
function stripGuardPhrase(text: string, guardPhrase: string): string {
  // Build a Unicode-aware regex that ignores accents, case, and punctuation
  // around the phrase. Easier than re-mapping normalized indices to original
  // indices: tolerantly match the phrase's letters/digits separated by any
  // non-letter/digit run.
  const tokens = normalizeForMatch(guardPhrase).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return text.trim();
  // For each token, allow accented variants by stripping diacritics in the
  // text on the fly via NFD + regex... simplest approach: split the original
  // text on word boundaries, normalize each piece, and slice out the matching
  // span. To keep complexity low, just remove the literal phrase (case-
  // insensitive) and, if not found, normalize-match-and-slice.
  const lowerText = text.toLowerCase();
  const lowerGuard = guardPhrase.toLowerCase();
  const idx = lowerText.indexOf(lowerGuard);
  if (idx >= 0) {
    return (text.slice(0, idx) + text.slice(idx + guardPhrase.length))
      .replace(/\s+/g, " ")
      .trim();
  }
  // Fallback: walk the original text, normalize a sliding window, and find
  // the normalized phrase. Costlier but covers accent / punctuation drift.
  const phrase = normalizeForMatch(guardPhrase);
  const normFull = normalizeForMatch(text);
  const nIdx = normFull.indexOf(phrase);
  if (nIdx < 0) return text.trim();
  // We don't have a precise mapping back to the original, so just trim any
  // trailing fragment of guard-like tokens.
  return text.replace(/[\p{L}\p{N}\s,.;:!?]+$/u, (tail) => {
    return normalizeForMatch(tail).includes(phrase) ? "" : tail;
  }).trim();
}

/**
 * Normalize text for guard-phrase matching.
 *
 *   "Τέλος εντολής!"  → "τελος εντολης"
 *   "  the END.  "    → "the end"
 *
 * Kept in lockstep with `normalizeGuardPhrase` in `src/config.ts` (the config
 * layer uses the same normalization to validate that the user's phrase is
 * non-empty after normalization).
 */
export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
