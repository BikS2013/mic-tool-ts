# Refined Request: Command Input Operator

## Category

Development

## Objective

Add a voice-agent protocol operator, `command input`, that sends the final processed section output to the currently focused input control.

## Scope

In scope:

- Add `input` as a persistent protocol operator alongside `refine`, `translate`, and `clipboard`.
- Support spoken commands `command input`, `command input on`, and `command input off`.
- Add `--input-default <on|off>` / `MIC_TOOL_TS_INPUT_DEFAULT`.
- Include `input` in `command status` and remembered runtime settings.
- Emit an `input.sent` JSONL event when output is successfully sent to the focused input control.
- On macOS, implement the output delivery by copying the final text to the clipboard with `pbcopy` and invoking paste through System Events (`Command-V`) against the currently focused UI element.
- Keep runtime failures fail-open: emit a non-fatal warning and do not fail the transcription process.

Out of scope:

- Linux/Windows focused-input implementations.
- Direct native Accessibility API integration.
- Restoring the previous clipboard contents.
- Sending partial transcripts to the focused input control.
- Inferring target application or moving focus automatically.

## Requirements

- The active pipeline at `command send` MUST include `input` after refinement and translation.
- The `input` operator MUST act only on complete submitted sections.
- The focused input control MUST be whatever macOS currently has focused when the paste command runs.
- The implementation MUST NOT require a new runtime dependency.
- The implementation MUST surface macOS Accessibility permission failures as non-fatal warnings, not process-fatal errors.
- `command status` MUST include the `input` operator state.
- Remembered protocol settings MUST persist the `input` operator state in `state.json`.
- Explicit `--input-default` / `MIC_TOOL_TS_INPUT_DEFAULT` MUST override remembered `input` state.

## Constraints

- The supported invocation remains `mic-tool-ts`.
- The project is currently macOS-first for live microphone capture; focused-input delivery may be macOS-only in this iteration.
- The tool must not persist transcript text or sent input text.

## Acceptance Criteria

- `command input` enables the operator and `command input off` disables it.
- With `input` enabled, `command send` sends the final processed output to the focused input control.
- Agent protocol mode emits `input.sent` after a successful send.
- `command status` reports `input=on|off`.
- Saved `state.json` includes the `input` operator and restores it on the next run unless explicitly overridden.
- Typecheck and tests pass.

## Assumptions

- “Current input control” means the active focused control in the frontmost macOS application.
- Clipboard-plus-paste is the most reliable dependency-free delivery mechanism for arbitrary Unicode text.
- The user is willing to grant macOS Accessibility permission to the terminal app when needed.

## Open Questions

- None blocking. A future release can add direct typing or non-macOS implementations.

## Original Request

> I want you to also add a command input feature option, which means that the output will be sent to the current input control. It might be a terminal, a GUI, or any other input control.
