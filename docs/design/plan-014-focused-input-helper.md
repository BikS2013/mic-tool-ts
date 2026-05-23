# Plan 014: Focused Input Helper

Refined request: `docs/reference/refined-request-focused-input-helper-plan-design.md`
Implementation request: `docs/reference/refined-request-focused-input-helper-implementation.md`
Prior investigation: `docs/reference/investigation-focused-control-text-delivery.md`
Focused design: `docs/design/focused-input-helper-design.md`
Codebase scan: `docs/reference/codebase-scan-focused-input-helper-implementation.md`
Status: implemented 2026-05-20.

## Goal

Replace the current single-path focused-input delivery design with a planned macOS-native helper architecture that can try direct focused-control insertion first and fall back safely when the target app does not support it.

The implemented architecture is:

1. Keep `mic-tool-ts` as the TypeScript orchestration layer and only user-facing command.
2. Add a bundled Swift helper for macOS focused text delivery.
3. Invoke the helper from the existing focused-input operator.
4. Preserve fail-open protocol behavior: no focused-input failure should terminate the session.

## Approach

Implement the architecture in four increments.

### Phase 1 — Helper Contract And Prototype Hardening

- Promote `test_scripts/focused-text-delivery-poc.swift` into a production helper source location, such as `native/macos/input-helper/`.
- Define the helper command surface:
  - `send --method auto`
  - `send --method ax-value`
  - `send --method unicode-events`
  - `send --method paste-keycode`
  - `diagnose`
- Read delivery text from stdin only.
- Emit exactly one JSON result on stdout.
- Emit human/debug diagnostics on stderr only.
- Return stable exit codes:
  - `0`: delivered.
  - `2`: expected actionable failure.
  - `1`: unexpected internal failure.

### Phase 2 — Delivery Methods

- Implement direct Accessibility insertion:
  - Get the system-wide focused UI element.
  - Verify `AXValue` is a string and settable.
  - Verify `AXSelectedTextRange` is available.
  - Replace selected UTF-16 range with input text.
  - Move cursor to the end of inserted text.
- Implement Unicode keyboard-event typing:
  - Clear modifier flags.
  - Post Unicode key down/up events through `CGEventKeyboardSetUnicodeString`.
  - Use it for short or medium text where direct AX insertion is unavailable.
- Implement clipboard-preserving key-code paste fallback:
  - Snapshot current `NSPasteboard` items and types where feasible.
  - Write input text.
  - Post physical `Command+V` using key code `9`.
  - Restore the previous pasteboard contents after a conservative delay.

### Phase 3 — TypeScript Integration

- Add a TypeScript focused-input helper adapter under the protocol or platform layer.
- Locate the bundled helper relative to the installed runtime path.
- Spawn the helper as a short-lived child process.
- Send processed output on stdin.
- Parse the helper's JSON stdout.
- Map helper failures into the existing `protocol.warning` path.
- Emit `input.sent` only when the helper returns successful delivery.
- Preserve the current `inputWriter` test injection seam so protocol tests stay focused and deterministic.

### Phase 4 — Packaging, Docs, And Verification

- Extend the build process to compile and copy the Swift helper into `dist/native/macos/`.
- Update user docs and configuration docs to describe the new focused-input delivery behavior and permissions.
- Add unit tests for helper-result parsing and TypeScript error mapping.
- Add Swift helper tests where practical for pure functions and result encoding.
- Add manual smoke scripts under `test_scripts/` for active focused-control testing.

## Components To Implement

- `mic-tool-ts-input-helper` Swift binary.
- Helper JSON result schema.
- TypeScript helper adapter and process runner.
- Helper path resolver.
- Permission/diagnostic mapping.
- Build step for native helper compilation.
- Documentation updates.
- Focused unit and manual smoke tests.

## Expected Files To Modify During Implementation

Production source:

- `src/protocol/controller.ts`
- `src/core/sessionRunner.ts` or a new platform helper module if injection wiring needs to move.
- New TypeScript module, likely `src/platform/macos/inputHelper.ts` or `src/protocol/focusedInput.ts`.
- New Swift helper source under `native/macos/input-helper/`.
- `package.json`
- `tsconfig.json` only if new source layout requires it.

Tests and scripts:

- `tests/protocol.test.ts`
- New focused helper adapter tests.
- New Swift helper test/build script if plain `swiftc` is used.
- `test_scripts/` manual smoke tests.

Documentation:

- `README.md`
- `docs/tools/mic-tool-ts.md`
- `docs/design/configuration-guide.md`
- `docs/design/project-functions.md`
- `docs/design/project-design.md`
- `Issues - Pending Items.md` if implementation discovers compatibility gaps.

## Deployment Model

- The helper is bundled with the package under `dist/native/macos/mic-tool-ts-input-helper`.
- The user continues to run `mic-tool-ts` or `mic-tool-ts ui`.
- `mic-tool-ts` discovers the helper relative to `dist/index.js`.
- No privileged daemon or LaunchAgent is installed in the first implementation.
- If a helper override is added later, an invalid override path must fail explicitly and must not silently fall back.

## Communication Model

`mic-tool-ts` spawns the helper for each focused-input delivery:

```text
mic-tool-ts
  -> spawn dist/native/macos/mic-tool-ts-input-helper send --method auto
  -> write processed text to stdin
  <- read one JSON object from stdout
  <- read diagnostics from stderr
```

The helper must never receive transcript text in argv.

## Verification Plan

Automated:

- TypeScript unit tests for adapter success/failure parsing.
- Protocol tests proving `input.sent` only follows successful helper delivery.
- Protocol tests proving helper failures emit `protocol.warning` and do not fail the session.
- Build test proving `pnpm build` produces the helper at the expected path.
- Swift compile test for helper source.

Manual:

- TextEdit native text field.
- Notes.
- Terminal and/or iTerm2.
- Safari and Chrome textareas.
- Google Docs or another contenteditable web editor.
- VS Code and Cursor.
- Slack or Discord.
- Greek text, English text, punctuation, multiline text, and long dictated sections.

## Acceptance Criteria

- Helper binary is built and bundled for macOS.
- Helper `diagnose` reports permission and focused-element status without mutating text.
- Helper `send --method auto` tries AX direct insertion, Unicode typing, then clipboard-preserving key-code paste.
- TypeScript adapter sends text over stdin and consumes JSON stdout.
- Transcript text does not appear in process arguments or persistent files.
- Existing focused-input protocol semantics remain intact: `input.sent` on success, warning on failure, no non-zero process exit for delivery failures.
- `pnpm typecheck`, relevant unit tests, `pnpm build`, and helper compile checks pass.
- Manual compatibility matrix results are recorded before marking implementation complete.

## Risks

- Direct Accessibility insertion is not universal and may not work for complex editors or browser content.
- Unicode event typing can be ignored by some frameworks or interact poorly with active modifier state.
- Clipboard restoration can race if a target app reads the pasteboard slowly.
- A separate helper may require separate Accessibility permission approval.
- Code signing may affect stable permission identity and should be tested before release packaging.

## Rollback Strategy

Keep the existing paste implementation available behind the same focused-input abstraction until the helper has passed manual compatibility checks. If helper discovery fails unexpectedly, emit a clear warning and either use the current paste implementation as an explicitly documented temporary compatibility mode or leave delivery failed-open, depending on the implementation decision recorded at coding time.


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
