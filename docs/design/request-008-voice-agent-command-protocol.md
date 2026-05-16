# Refined Request: Voice Agent Command Protocol

## Category

Design / Documentation

## Objective

Define a communication protocol that lets `mic-tool-ts` serve two oral workflows at the same time:

1. Plain dictation, where spoken text continues to be transcribed and displayed without being treated as an agent command.
2. Stateful section processing, where spoken control markers enable/disable operators such as refinement, translation, and clipboard copy, and `/end` submits the current paragraph or text section for processing by the active operators.

The design must avoid treating every paragraph boundary as "send this to an agent." `/end` is a text-section submit marker: it closes the current dictated paragraph/section and processes it through the selected active operators.

## Scope

In scope:

- Propose the user-facing speech protocol: operator state commands, text-section submit, text-section cancel, optional literal-marker escape.
- Propose the machine-facing event format an agent or automation layer can consume.
- Propose how dictation output remains usable while `/end` marks sections that should be processed.
- Propose how active operators such as `refine`, `translate`, and `clipboard` are applied after `/end`.
- Identify configuration flags and environment variables that would be needed.
- Identify implementation modules, tests, and documentation updates.

Out of scope for this proposal:

- Implementing the protocol in TypeScript.
- Choosing a specific downstream agent integration API beyond a stdout/stdin-safe event stream.
- Adding hotkeys, GUI controls, wake-word engines, or local speech models.
- Replacing the existing Soniox / ElevenLabs transcription provider layer.

## Requirements

- The current dictation workflow must remain available as the default behavior.
- Operator state changes must use explicit spoken control markers.
- Marker detection must run only on finalized STT text, not on unstable partials.
- Markers must be normalized the same way as the existing guard phrase: case-insensitive, accent-insensitive, punctuation-tolerant.
- Section payloads must exclude the spoken `/command ...`, `/end`, and `/cancel` markers.
- `/end` must mark the end of the current paragraph or text section and trigger processing through the currently active operators.
- `/cancel` must discard the current paragraph or text section without processing.
- Refinement, translation, clipboard copy, and future operators must be modeled as session state toggles.
- Translation must run on the complete submitted section, not partial words. By default, Greek source text should translate to English, and English source text should translate to Greek.
- The machine-readable protocol must be line-oriented and pipe-safe.
- Human transcript output and agent protocol output must not be mixed in one stream unless explicitly configured.
- Missing required configuration for an enabled mode must raise a typed configuration error rather than falling back silently.

## Constraints

- The supported invocation remains the direct OS command `mic-tool-ts`.
- Project-specific configuration must use the `MIC_TOOL_TS_*` prefix.
- Secrets and provider keys must continue using the existing four-tier resolution chain.
- The design must fit the current architecture: STT provider -> renderer / turn-aware processing -> stdout.
- No new runtime dependency is required for the proposed protocol.

## Acceptance Criteria

- A proposal document exists under `docs/design` describing the protocol, output events, configuration, implementation plan, and test plan.
- The proposal preserves the default dictation behavior.
- The proposal defines how an agent or automation layer can reliably consume state-change and processed-section events without parsing free-form transcript text.
- The proposal explains how `/end` acts as the explicit paragraph/text-section submit marker for active operators.
- The project design and functional requirements documents are updated to register the proposed feature as not yet implemented.
- Any unimplemented accepted/proposed work is tracked in `Issues - Pending Items.md`.

## Assumptions

- The agent can read either `stdout` or a file/pipe fed by `mic-tool-ts`.
- The user can learn a small number of explicit marker phrases.
- The protocol should be robust before it is clever: deterministic slash-style markers are preferred over inference-based intent detection.
- The initial version should not execute arbitrary agent tasks directly. It should emit structured state and section events and let a downstream agent decide what to do with processed text.

## Open Questions

- Resolved in implementation: `agent-protocol` writes JSONL events to stdout; `hybrid` requires `--protocol-output <path>` and writes JSONL there while keeping human text on stdout.
- Resolved in implementation: operator defaults begin off unless set by CLI/env or restored from remembered non-secret runtime state.
- Resolved in implementation: `section.processed` includes the raw text, final output, and intermediate fields such as `refined_text`, `source_language`, and `target_language` when applicable.
- Resolved in implementation: `command send` processes through the active operators. If no operators are active and clipboard is off, it submits/processes the section as raw output without copying.

## Implementation Update

The protocol is implemented with command-prefixed spoken markers:

- `command refine`, `command translate`, and `command clipboard` toggle persistent operators; adding `off` disables an operator.
- `command status` reports the current operator state, translation policy, and whether an unsent section is pending.
- `command send` submits the current section for processing.
- `command cancel` discards the current section.
- `literal phrase` treats the next recognized marker as dictated text.

Protocol events include `session.started`, `state.changed`, `status.reported`, `section.submitted`, `section.processed`, `clipboard.copied`, `section.cancelled`, `protocol.warning`, and `session.ended`.

Runtime protocol settings are remembered across graceful restarts in `~/.tool-agents/mic-tool-ts/state.json`. The file stores only non-secret operator state and `translation_policy`; explicit CLI/env defaults override the saved state.

## Original Request

> I plan to use this tool as a way to communicate orally with my agents. So I want a way to, let’s say, flag the initiation of a command to the agent, or flag the end of a command to the agent.
>
> I want you to propose an approach to that and prepare a proposal on how we could build this kind of communication protocol.
>
> Of course, I still want to use it as a dictation tool, so I won’t have the option of marking the end of a paragraph in order for the paragraph to be refined by an LLM.
