# Refined Request: Persist Protocol Settings

## Category

Development

## Objective

Remember the live voice-agent protocol settings when `mic-tool-ts` exits and restore those settings the next time the tool starts.

## Scope

In scope:

- Persist non-secret runtime protocol settings:
  - `refine` operator state.
  - `translate` operator state.
  - `clipboard` operator state.
  - `translation_policy`.
- Save the settings during graceful shutdown.
- Load the settings at startup.
- Let explicit CLI flags and configured env values override saved settings.
- Store the state under the per-user tool folder `~/.tool-agents/mic-tool-ts/`.
- Add focused tests and update user/design documentation.

Out of scope:

- Persisting API keys or secret provider configuration.
- Persisting current dictated section text.
- Persisting microphone/STT connection state.
- Persisting transient protocol output path or interaction mode unless explicitly configured.
- Synchronizing settings across machines.

## Requirements

- The persisted state file MUST NOT contain API keys, provider endpoints, prompts, raw transcripts, or processed section text.
- The persisted state file MUST use the per-user tool folder `~/.tool-agents/mic-tool-ts/`.
- The persisted state file SHOULD be named `state.json`.
- The per-user tool folder MUST be created with mode `0700` when the tool creates it.
- The persisted state file MUST be written with mode `0600` when the tool creates it.
- The tool MUST restore saved operator state and translation policy on startup when the corresponding CLI/env default was not explicitly configured.
- Explicit CLI flags and env-chain values for `--refine-default`, `--translate-default`, `--clipboard-default`, and `--translation-policy` MUST override saved state.
- `command status` MUST report the effective restored settings after startup.
- Persistence write failures during shutdown MUST be reported to stderr but MUST NOT prevent graceful exit.
- Invalid persisted state at startup MUST be treated as configuration corruption and surfaced as a typed configuration error.

## Constraints

- The supported invocation remains `mic-tool-ts`.
- No new runtime dependency is required.
- The implementation must stay within the existing protocol/controller architecture.
- The feature must not create fallback values for required configuration settings.

## Acceptance Criteria

- If the user enables `command refine`, exits cleanly, and starts the tool again without an explicit refine default, the next session starts with `refine` enabled.
- If the user passes `--refine-default off`, that explicit flag wins over a saved `refine: true` value.
- The saved file contains only non-secret protocol settings and metadata.
- `command status` reports restored values.
- Typecheck and the full test suite pass.

## Assumptions

- “Settings” refers to the voice-agent protocol settings that can change during a session, not the full resolved CLI/STT/LLM configuration.
- Persisting on graceful shutdown is sufficient for this feature; hard process termination may lose the latest state.
- Translation policy is included even though it currently changes only through config, because it is part of the status report and protocol behavior.

## Open Questions

- None blocking. A future request can add an explicit command to reset saved settings.

## Original Request

> I want you to add a feature to remember the settings when The tool closed. and start with the same settings next time.
