# Refined Request: Documentation Sync

## Category

Documentation

## Objective

Synchronize the README and project documentation with the current `mic-tool-ts` behavior after the latest protocol updates.

## Scope

In scope:

- Update `README.md`.
- Update the authoritative design and function documents.
- Update the configuration guide and tool reference.
- Update the voice-agent protocol plan and its HTML preview.
- Clarify `command status`, `status.reported`, remembered protocol settings, and the `state.json` persistence file.

Out of scope:

- Changing runtime behavior.
- Rewriting historical research notes whose purpose is to preserve earlier investigation context.
- Adding new configuration flags.

## Requirements

- Documentation must describe `command status`.
- Documentation must describe remembered runtime protocol settings and override precedence.
- Documentation must state that `state.json` stores only non-secret protocol state.
- Documentation must keep the supported invocation as `mic-tool-ts`.
- Documentation must keep secret setup under `~/.tool-agents/mic-tool-ts/.env`.

## Constraints

- Do not document package-manager scripts as the installed-user invocation.
- Do not imply that API keys or transcripts are persisted in `state.json`.
- Do not alter source code for this documentation-only request.

## Acceptance Criteria

- README and design docs mention `command status` and remembered protocol settings.
- The configuration guide explains how remembered state interacts with CLI/env defaults.
- The tool reference points to the state file and override behavior.
- `plan-007-voice-agent-command-protocol.html` is regenerated from the updated Markdown.

## Assumptions

- "The rest of the documentation" means current user-facing and authoritative design docs, not every historical reference artifact.

## Open Questions

- None.

## Original Request

> I want you to update the README file and the rest of the documentation.


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
