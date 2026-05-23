# Refined Request: Wrapped Overwrite Rendering

## Category

Development / Bug Fix

## Objective

Fix the human transcript renderer so `overwrite` mode remains readable when a live partial transcript exceeds the terminal line width and wraps across multiple physical rows.

## Scope

In scope:

- Update TTY `overwrite` rendering so it clears all physical terminal rows occupied by the previously rendered partial before painting the next partial.
- Keep `append` and `final-only` output unchanged.
- Keep pipe safety unchanged: non-TTY stdout still downgrades `overwrite` to `append`.
- Add focused renderer tests for wrapped-line overwrite behavior.
- Update the renderer requirements and project design documentation.

Out of scope:

- Changing STT provider tokenization or partial emission frequency.
- Adding a new output mode.
- Introducing terminal UI dependencies.
- Changing human transcript behavior in `agent-protocol` JSONL mode.

## Requirements

- The renderer MUST detect the current terminal column width when stdout is a TTY and `overwrite` mode is active.
- The renderer MUST track how many physical terminal rows the previous overwrite-mode partial occupied.
- Before rendering a new overwrite-mode partial, the renderer MUST clear every physical row occupied by the previous partial and return the cursor to the first row of the overwrite region.
- Rendering a new partial MUST write the latest transcript snapshot once, regardless of whether the update came from one character, one word, or a larger STT partial snapshot.
- Finalized text MUST still be committed with a newline and reset overwrite state.
- Empty partial suppression and identical-partial suppression MUST continue to work.
- Non-TTY output MUST remain free of ANSI cursor movement and carriage-return artifacts.

## Constraints

- The supported user invocation remains the direct OS command `mic-tool-ts`.
- The change must stay within the existing `StdoutRenderer` abstraction unless tests expose a broader integration issue.
- The implementation must use built-in terminal control sequences only; no new runtime dependency is justified for this behavior.
- The renderer must remain best-effort and must not throw for missing TTY metadata such as `columns`.

## Acceptance Criteria

- Long overwrite-mode partials that wrap across multiple terminal rows do not cause repeated or stale lines above the current transcript.
- Replacing a longer wrapped partial with a shorter partial clears the extra physical rows.
- Replacing a shorter partial with a longer wrapped partial paints the new wrapped text once.
- Final output after wrapped partials ends cleanly on a new line.
- Existing renderer tests continue to pass.

## Assumptions

- The user is reporting a TTY `overwrite` rendering artifact, not a provider-level repeated-token issue.
- "For each character (or word?)" describes how often STT partial snapshots arrive; the renderer should handle each snapshot uniformly rather than operating at character or word granularity.
- A fallback terminal width of 80 columns is acceptable when a TTY stream does not expose a valid `columns` value.

## Open Questions

- None blocking. If a future workflow needs multi-line editing behavior instead of single live-partial repainting, that should be handled as a separate terminal UI feature.

## Original Request

> When the text exceeds the length of the line, then for each character (or word?), repeat the lines above the current.


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
