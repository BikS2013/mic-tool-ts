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

- Should section events be emitted to `stdout` in protocol mode, or should the tool support a separate `--protocol-output <path>` target?
- Should any operators be enabled by default, or should all operator state begin as off?
- Should processed-section events include every intermediate value (`raw_text`, `refined_text`, `translated_text`) or only the final selected output plus audit metadata?
- Should `/end` also copy raw text when no operators are active and clipboard is off, or should it only emit/render a section boundary?

## Original Request

> I plan to use this tool as a way to communicate orally with my agents. So I want a way to, let’s say, flag the initiation of a command to the agent, or flag the end of a command to the agent.
>
> I want you to propose an approach to that and prepare a proposal on how we could build this kind of communication protocol.
>
> Of course, I still want to use it as a dictation tool, so I won’t have the option of marking the end of a paragraph in order for the paragraph to be refined by an LLM.
