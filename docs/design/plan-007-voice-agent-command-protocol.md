# Plan 007: Voice Agent Command Protocol

## Status

Implemented 2026-05-16. Follow-up additions are also implemented:

- `command status` reports current protocol settings without changing state.
- Runtime protocol settings are remembered across graceful restarts in `~/.tool-agents/mic-tool-ts/state.json`.
- `command input` sends the final processed section output to the currently focused macOS input control.

HTML preview: `docs/design/plan-007-voice-agent-command-protocol.html`.

## Goal

Add a speech-control protocol that lets `mic-tool-ts` be used as an oral input layer for agents while preserving normal dictation. The protocol must distinguish four concepts that are currently partially coupled:

- **Dictation text**: continuous transcript intended for a human or plain text sink.
- **Text section**: the paragraph or section accumulated until the user says `command send`.
- **Operator state**: persistent toggles such as `refine`, `translate`, `clipboard`, and `input`.
- **LLM operation**: optional cleanup, translation, suggestion, criticism, or another transformation applied to a submitted section.
- **Remembered protocol settings**: non-secret operator state and translation policy restored on the next run unless explicit startup config overrides them.

## Recommended Approach

Implement a small state machine above finalized STT text and below output rendering. The state machine recognizes explicit spoken markers, maintains operator state, reports current settings on `command status`, and submits the current text section when `command send` is spoken.

The recommended initial state model is:

| State | Meaning | Accepted marker actions |
|-------|---------|-------------------------|
| `capturing_section` | Normal transcription. Finalized non-command text is appended to the current section buffer. | `command refine|translate|clipboard|input` changes operator state; `command status` reports current settings; `command send` submits the section; `command cancel` discards the section. |
| `processing_section` | The submitted section is being processed through active operators. | New speech continues into the next section; processing is asynchronous and fail-open. |

Do not infer control intent from natural language. Explicit command-prefixed markers are safer, easier to test, and less likely to accidentally trigger processing.

## Proposed Spoken Markers

Defaults should be configurable and should be selected for low collision with ordinary dictation.

| Marker | Default phrase | Purpose |
|--------|----------------|---------|
| `state_command` | `command <operator> [on|off]` | Change persistent processing state. Missing `on|off` means `on`. |
| `status_command` | `command status` | Report current operator state, translation policy, and whether an unsent section is pending. |
| `section_end` | `command send` | Submit the current paragraph or text section for processing by active operators. |
| `section_cancel` | `command cancel` | Drop the current paragraph or text section without processing it. |
| `literal_next` | `literal phrase` | Treat the next recognized marker phrase as ordinary dictated text. |

Greek equivalents can be added as aliases, for example:

- `εντολή` as an alias for `command`.
- `τέλος` or `τέλος ενότητας` as aliases for `command send`.
- `άκυρο` as an alias for `command cancel`.

The existing default guard phrase, `τέλος εντολής`, should not remain hard-wired as "end paragraph for refinement" in agent protocol mode. It can become one alias for `section_end`.

## Stateful Operators

`command <operator>` changes a persistent session state. It does not by itself submit text for processing.

Recommended first operators:

| Spoken command | State change |
|----------------|--------------|
| `command refine` | Enable refinement for future submitted sections. |
| `command refine off` | Disable refinement. |
| `command translate` | Enable translation for future submitted sections. |
| `command translate off` | Disable translation. |
| `command clipboard` | Copy the final processed result of future submitted sections to the clipboard. |
| `command clipboard off` | Disable clipboard copy. |
| `command input` | Send the final processed result of future submitted sections to the currently focused macOS input control. |
| `command input off` | Disable focused-input delivery. |
| `command status` | Report current settings. Does not change state or submit text. |

The active pipeline at `command send` is:

```text
raw section
  -> refine, if refine is on
  -> translate, if translate is on
  -> render / emit final output
  -> copy final output to clipboard, if clipboard is on
  -> send final output to focused input, if input is on
```

Translation must run on the complete submitted section, not partial words. With the default `opposite` translation policy:

- Greek source text translates to English.
- English source text translates to Greek.
- Language detection runs on the complete section after refinement when refinement is enabled, otherwise on the raw section.

## Output Protocol

Introduce an agent protocol output mode that emits JSON Lines. Each line is one complete UTF-8 JSON object.

Recommended event names:

```json
{"type":"session.started","protocol":"mic-tool-ts.voice-agent.v1","seq":1}
{"type":"state.changed","seq":2,"key":"refine","value":true}
{"type":"state.changed","seq":3,"key":"translate","value":true,"target_policy":"opposite"}
{"type":"status.reported","seq":4,"operators":{"refine":true,"translate":true,"clipboard":false,"input":true},"translation_policy":"opposite","pending_section":true}
{"type":"section.submitted","seq":5,"section_id":"sec_000001","raw_text":"..."}
{"type":"section.processed","seq":6,"section_id":"sec_000001","operators":["refine","translate","input"],"raw_text":"...","refined_text":"...","source_language":"el","target_language":"en","output_text":"..."}
{"type":"clipboard.copied","seq":7,"section_id":"sec_000001"}
{"type":"input.sent","seq":8,"section_id":"sec_000001"}
{"type":"section.cancelled","seq":9,"section_id":"sec_000002","reason":"spoken_cancel"}
{"type":"session.ended","seq":10,"reason":"SIGINT"}
```

Rules:

- `seq` is monotonically increasing per process.
- `section_id` is assigned when a section starts accumulating text or when it is submitted.
- Consumers can rely on `section.processed` as the event that contains the final user-facing result.
- Marker phrases are removed from `raw_text`.
- State changes are emitted as `state.changed` events.
- Status reports are emitted as `status.reported` events and never include secrets.
- Events never contain unescaped newlines outside JSON strings.
- `stdout` should contain either human transcript text or JSONL protocol events, not both by default.

## User-Facing Modes

Add a top-level interaction mode:

| Mode | Behavior |
|------|----------|
| `dictation` | Plain transcript/output on stdout. `command <operator>` changes operator state and `command send` submits the current section for human-facing processing. |
| `agent-protocol` | JSONL state, status, and section events on stdout. Human status/logging stays on stderr. |
| `hybrid` | Plain dictation remains on stdout and protocol events go to an explicit file or pipe target. This mode should require `--protocol-output`; it must not silently mix streams. |

The implemented tool supports all three modes. `hybrid` requires `--protocol-output` so human transcript text and machine JSONL events are not silently mixed.

## Proposed Configuration

All values follow the existing four-tier resolution chain.

| CLI flag | Env var | Default | Notes |
|----------|---------|---------|-------|
| `--interaction-mode <dictation|agent-protocol|hybrid>` | `MIC_TOOL_TS_INTERACTION_MODE` | `dictation` | Keeps current behavior as default. |
| `--command-phrase <phrase>` | `MIC_TOOL_TS_COMMAND_PHRASE` | `command` | Introduces state commands such as `command refine`. |
| `--section-end-phrase <phrase>` | `MIC_TOOL_TS_SECTION_END_PHRASE` | `command send` | Submits the current section for processing. |
| `--section-cancel-phrase <phrase>` | `MIC_TOOL_TS_SECTION_CANCEL_PHRASE` | `command cancel` | Discards the current section. |
| `--literal-next-phrase <phrase>` | `MIC_TOOL_TS_LITERAL_NEXT_PHRASE` | `literal phrase` | Optional escape hatch. |
| `--refine-default <on|off>` | `MIC_TOOL_TS_REFINE_DEFAULT` | `off` | Initial `refine` operator state. |
| `--translate-default <on|off>` | `MIC_TOOL_TS_TRANSLATE_DEFAULT` | `off` | Initial `translate` operator state. |
| `--translation-policy <opposite|to-en|to-el>` | `MIC_TOOL_TS_TRANSLATION_POLICY` | `opposite` | `opposite`: Greek to English, English to Greek. |
| `--clipboard-default <on|off>` | `MIC_TOOL_TS_CLIPBOARD_DEFAULT` | `off` | Initial clipboard-copy state. |
| `--input-default <on|off>` | `MIC_TOOL_TS_INPUT_DEFAULT` | `off` | Initial focused-input delivery state. |
| `--protocol-output <path>` | `MIC_TOOL_TS_PROTOCOL_OUTPUT` | required for `hybrid` | Avoids mixed stdout streams. |

The existing `--guard-phrase` can be retained for backward compatibility, but the new section marker names should become the preferred protocol surface.

Runtime protocol settings are remembered outside the four-tier env chain. On graceful shutdown, the tool writes `~/.tool-agents/mic-tool-ts/state.json` with non-secret state only:

```json
{
  "version": 1,
  "saved_at": "2026-05-16T19:30:00.000Z",
  "protocol": {
    "operators": {
      "refine": true,
      "translate": false,
      "clipboard": false,
      "input": true
    },
    "translation_policy": "opposite"
  }
}
```

On startup, saved values apply only when the matching CLI/env setting is absent. Explicit `--refine-default`, `--translate-default`, `--clipboard-default`, `--input-default`, and `--translation-policy` values override saved state.

## Implementation Sketch

Add a new protocol layer rather than expanding `GuardPhraseTurnDetector` until it becomes responsible for unrelated concepts.

Recommended modules:

- `src/protocol/types.ts`: event types, interaction modes, operator state, marker config.
- `src/protocol/markerMatcher.ts`: normalized marker matching and marker stripping.
- `src/protocol/stateMachine.ts`: section capture, state command parsing, `command status` reporting, `command send` submit, `command cancel` discard, and settings snapshots.
- `src/protocol/jsonlWriter.ts`: line-oriented protocol sink.
- `src/protocol/controller.ts`: connects renderer, refiner/translator, clipboard sink, focused-input sink, and protocol writer.
- `src/protocol/settingsStore.ts`: loads/saves remembered non-secret runtime protocol settings.

Orchestrator wiring:

1. Resolve config.
2. Build the base renderer.
3. Build optional LLM refiner.
4. Route finalized STT text through the protocol controller.
5. If a finalized segment contains a state command, update operator state and exclude the marker from section text.
6. If a finalized segment contains `command status`, report effective settings.
7. If a finalized segment contains `command send`, submit the accumulated section through the active operator pipeline.
8. If `interactionMode === "agent-protocol"`, write JSONL events to stdout.
9. On graceful shutdown, persist remembered protocol settings.
10. Continue sending all diagnostics to stderr.

## Matching Semantics

Use finalized STT text only. Partial text is too unstable and will cause false state transitions.

Marker matching should:

- Use the existing normalization style for ordinary phrase aliases: NFD, strip combining marks, lowercase, collapse punctuation and whitespace.
- Preserve slash-marker intent for explicitly configured slash markers. Slash forms MUST NOT degrade to bare words after punctuation normalization.
- Match across consecutive final segments, with a bounded rolling window.
- Remove marker phrases and state commands from section payloads.
- Prefer boundary-like matches. For example, `command` at the start of a final segment should be accepted; `commandment` or `cancellation` should not match.
- Emit verbose diagnostics for state transitions without logging secrets.

## Failure Behavior

- If `command <operator>` has an unknown operator or value, emit a warning on stderr (and `protocol.warning` in JSONL mode) and do not change state.
- If `command status` is spoken, report settings and do not change state.
- If `command send` is spoken when the current section is empty, emit a no-op `section.empty` diagnostic under verbose mode and do not call the LLM.
- If refinement or translation fails after `command send`, emit/render the best available prior value and do not fail the process.
- If clipboard copy fails, log under verbose and keep the processed output.
- If focused-input delivery fails, emit a non-fatal warning and keep the processed output. The implemented macOS path uses `pbcopy` plus System Events Command-V, so Accessibility permission may be required for the terminal app running `mic-tool-ts`.
- If persisted settings are malformed at startup, raise `InvalidConfigurationError` so the user can delete or fix `state.json`.
- If settings cannot be saved during shutdown, warn on stderr and continue graceful exit.
- If shutdown occurs with a non-empty unsubmitted section, emit `section.cancelled` with reason `shutdown` before `session.ended`.

## Testing Plan

Add focused unit tests, not live microphone tests, for the protocol logic.

Required tests:

- Marker normalization matches case, accents, punctuation, and cross-final phrases while preserving slash-marker intent.
- `command refine`, `command translate`, `command clipboard`, `command input`, and their `off` forms update operator state.
- `command status` emits/renders the current restored operator state and pending-section flag without mutating state.
- `command send` submits the current section and strips markers from payload.
- `command cancel` drops the current section and emits `section.cancelled`.
- Dictation mode remains compatible with current renderer behavior.
- Agent protocol mode emits valid JSONL and no carriage-return overwrite artifacts.
- Refinement success includes `refined_text`.
- Translation success includes `source_language`, `target_language`, and `output_text`.
- Operator failure emits the best available text only and does not exit non-zero.
- Shutdown with an unsubmitted section emits cancellation.
- Focused-input delivery emits `input.sent` on success and fails open on delivery errors.
- Runtime settings persistence saves only non-secret protocol settings, including `input`.
- Explicit CLI/env defaults override remembered protocol settings.

## Documentation Plan

Update:

- `README.md`: add an "Oral Agent Commands" section with examples.
- `docs/design/configuration-guide.md`: document new flags/env vars and priority.
- `docs/design/configuration-guide.md`: document remembered `state.json` behavior and override precedence.
- `docs/tools/mic-tool-ts.md`: mention agent protocol mode.
- `docs/design/project-design.md`: replace this proposal with implemented design details after build.
- `docs/design/project-functions.md`: promote proposed FRs to implemented FRs after build.

## Example Workflows

Plain dictation remains unchanged:

```sh
mic-tool-ts
```

Agent protocol mode:

```sh
mic-tool-ts --interaction-mode agent-protocol
```

Example speech:

```text
These are notes for later.
command refine.
command translate.
command input.
Open docs design project design and find the LLM refinement section.
command status.
command send.
Continue dictating normal notes.
```

The section between the state commands and `command send` is processed through the active pipeline: refine first, then translate, then focused-input delivery when enabled. The downstream agent consumes `section.processed` and ignores ambient dictation events unless it wants context.

## Recommendation

Build this as a protocol layer with explicit operator state, `command status` reporting, `command send` section submission, remembered non-secret runtime settings, and JSONL events. Do not expand the existing guard phrase into a general-purpose command parser. Keep dictation as the default, make protocol events opt-in, and let active operators process complete submitted sections only.


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
