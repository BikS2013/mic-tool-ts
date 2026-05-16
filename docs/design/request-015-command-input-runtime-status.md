# Refined Request: Command Input Runtime Status

## Category
Development / bug investigation.

## Objective
Verify whether the `command input` voice-agent operator is implemented and available during runtime, identify why a previous implementation attempt failed or did not become observable, and make a focused fix if the runtime path is incomplete or broken.

## Scope
In scope:

- Inspect the current implementation status for `command input`.
- Verify CLI configuration, protocol state handling, operator pipeline wiring, focused-input delivery, tests, docs, and built/installed runtime behavior.
- Fix concrete gaps that prevent `command input` from being recognized, reported, persisted, or executed.
- Document the issue and solution in `Issues - Pending Items.md`.

Out of scope:

- Adding non-macOS focused-input delivery.
- Replacing the existing macOS `pbcopy` plus System Events paste strategy.
- Changing the voice protocol semantics beyond making the documented `command input` behavior work.
- Running a live microphone end-to-end test unless local credentials, microphone permission, and macOS permissions are already available.

## Requirements

- `command input` MUST enable the `input` operator during a live voice-agent session.
- `command input off` MUST disable the `input` operator.
- `command status` MUST report the current `input` state.
- `command send` MUST call focused-input delivery after the section pipeline completes when `input` is enabled.
- A successful focused-input delivery MUST emit `input.sent` in protocol modes.
- Focused-input delivery failures MUST be fail-open and not terminate the process.
- The installed `mic-tool-ts` runtime path MUST use code that includes the `command input` implementation after build.

## Constraints

- Do not perform version-control operations.
- Do not introduce new runtime dependencies.
- Keep configuration strict: missing required configuration must raise typed errors rather than falling back silently.
- Keep human transcript output and JSONL protocol output stream-separated.

## Acceptance Criteria

- Focused tests demonstrate that `command input` changes protocol state, appears in status, is persisted/restored, and triggers the focused-input writer on section submission.
- Type checking passes.
- If relevant, the built command or help output confirms the runtime includes the updated CLI/config surface.
- `Issues - Pending Items.md` records the detected issue and the implemented solution.

## Assumptions

- The user's phrase "command input" refers to the voice-agent protocol operator documented in `docs/design/request-013-command-input-operator.md`.
- The correct user-facing command remains the installed OS command `mic-tool-ts`.
- A focused local test suite is sufficient unless the bug requires live STT audio to reproduce.

## Open Questions

- None blocking. Live macOS Accessibility permission can only be confirmed manually by running the installed tool against a focused input control.

## Original Request

> Οκ, command input is not implemented yet, or it is not available during runtime—maybe, I don't know.
>
> You must check the status of the implementation because, during the implementation, the process failed. And do something.
