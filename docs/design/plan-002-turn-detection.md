# plan-002 — Turn detection via guard phrase

## Goal
Replace the always-continuous stream model with a turn-based model. A turn ends when a configurable guard phrase appears (anywhere) in the recent finalized transcript. On detection: render an empty line on the console to mark the boundary, then start a new turn.

Default guard phrase (Greek): `τέλος εντολής`.

## Decisions (user-confirmed)
- The guard phrase remains visible inside the final line that triggered the turn end. We do NOT strip it.
- Detection runs over a rolling buffer of recent finals within the current turn, not only the latest final line, so the phrase can span across consecutive finalized utterances.

## Design

### New module: `src/turn/detector.ts`
- Exports `TurnAwareRenderer` (subset of `Renderer` — `partial / final / dispose`).
- Exports `GuardPhraseTurnDetector` implementing `TurnAwareRenderer`.
- Wraps a `Renderer`; passes `partial()` through unchanged; on each `final()`:
  1. Forwards the text to the inner renderer.
  2. Appends it to an internal rolling buffer (space-separated, capped at 2000 chars).
  3. Normalizes the buffer (NFD decompose → strip combining marks → lowercase → collapse non-letter/non-digit to single space → trim).
  4. If the normalized buffer contains the normalized guard phrase, calls `renderer.turnBoundary()`, resets the buffer, and (under verbose) writes a diagnostic to stderr.
- Normalization is symmetric on both sides (buffer and guard phrase), so accents, case, and stray punctuation never block a match.
- `dispose()` delegates to the inner renderer.

### Renderer change: add `turnBoundary()`
- In `overwrite`, `append`, and `final-only`, `turnBoundary()` writes a single `\n` to the output stream. The preceding `final()` already terminated its line, so this produces the blank line.
- No-op if `disposed`.

### Config change: add `guardPhrase`
- New flag: `--guard-phrase <phrase>`, default `τέλος εντολής`.
- Added to `ResolvedConfig.guardPhrase: string`.
- Validation: must be non-empty after the same normalization the detector uses (so the user can't pass e.g. `"!!!"` which would normalize to nothing).
- `--help` lists the flag and default; `--verbose` logs the active guard phrase at startup (it's not sensitive).

### Orchestrator wiring
- `main.ts` constructs the inner `StdoutRenderer`, wraps it in `GuardPhraseTurnDetector`, then passes the wrapper to the rest of the pipeline. Shutdown disposes the wrapper (which delegates to the inner renderer).

## Test impact
- New `tests/turn-detector.test.ts` — unit tests for normalization, match-within-final, match-across-finals, buffer cap, no-match passthrough, verbose log on detection.
- `tests/renderer.test.ts` — add cases for `turnBoundary()` in all three modes.
- `tests/config.test.ts` — add `--guard-phrase` default and override coverage; reject empty/whitespace-only/normalize-to-empty phrases.
- `tests/main.test.ts` — verify the orchestrator routes finals through the detector and disposes correctly.

## Non-goals
- Auto-detect language for the phrase. (User configures.)
- Multiple guard phrases. (Single phrase only; user can pick one.)
- Stop transcription on turn boundary. (We continue listening; the boundary is purely a console-rendering marker.)
