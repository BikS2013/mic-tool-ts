# Refined Request: Command Status

## Category

Development

## Objective

Add a spoken protocol command, `command status`, that reports the current voice-agent command settings during a live `mic-tool-ts` session.

## Scope

In scope:

- Recognize `command status` as a dedicated protocol command.
- Report the current protocol operator state for `refine`, `translate`, and `clipboard`.
- Report the active translation policy.
- Report whether the current section buffer contains unsent text.
- Emit a machine-readable protocol event in agent-protocol or hybrid modes.
- Render a human-readable status line in dictation or hybrid modes.
- Update focused protocol tests and documentation.

Out of scope:

- Reporting secret values such as provider API keys or LLM credentials.
- Reporting every CLI/runtime config value.
- Adding a configurable phrase for the status command.
- Changing existing `command <operator>` state-toggle behavior.

## Requirements

- `command status` MUST be recognized only after finalized STT text.
- `command status` MUST NOT enable or disable any operator.
- `command status` MUST be removed from the human transcript payload.
- The status report MUST include `refine`, `translate`, `clipboard`, `translation_policy`, and `pending_section`.
- In `agent-protocol` mode, the tool MUST emit a JSONL `status.reported` event and MUST NOT render human transcript/status text to stdout.
- In `dictation` mode, the tool MUST render a human-readable status line to stdout.
- In `hybrid` mode, the tool MUST render the human-readable status line to stdout and emit the JSONL event to the configured protocol output.
- The status report MUST NOT include secrets or API key values.

## Constraints

- The supported user-facing invocation remains `mic-tool-ts`.
- The implementation must fit the existing protocol state machine and controller.
- No new runtime dependency is required.

## Acceptance Criteria

- Saying `command status` after toggling operators reports the current operator state.
- Saying `command status` with buffered dictated text reports `pending_section: true` without submitting the section.
- Existing `command refine`, `command translate`, `command clipboard`, `command send`, and `command cancel` behavior remains unchanged.
- Protocol JSONL output remains one UTF-8 JSON object per line with monotonically increasing `seq` values.
- Typecheck and test suite pass.

## Assumptions

- “Current settings” means voice-agent protocol settings, not the full resolved CLI/STT/LLM configuration.
- The status command should be deterministic and local; it should not call an LLM.
- A fixed phrase is sufficient because it follows the existing `command <word>` convention.

## Open Questions

- None blocking. A future request can expand the report to include non-secret STT/LLM configuration if needed.

## Original Request

> i want you to add a command : command status to report the current settings
