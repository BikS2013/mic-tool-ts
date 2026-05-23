# Refined Request: Persist Push-To-Talk Setting

## Category

Development

## Objective

Persist the Electron UI push-to-talk settings across `mic-tool-ts ui` sessions so a user's enabled/disabled state and selected hotkey survive quitting and reopening the UI.

## Scope

In scope:

- Add a non-secret UI settings persistence mechanism for push-to-talk state.
- Persist both push-to-talk enabled state and hotkey accelerator, because the UI treats them as one feature setting.
- Load persisted push-to-talk settings during UI startup before configuring the global hotkey.
- Save push-to-talk settings when the renderer updates UI settings.
- Add focused unit tests for load/save, invalid persisted state handling, and UI runtime settings restoration.
- Update project design/functions and issue tracking documentation.

Out of scope:

- Persisting all UI settings.
- Persisting API keys, transcript text, protocol events, or processed output.
- Changing the spoken voice-agent protocol persistence behavior.
- Adding a new visible UI control.
- Adding runtime dependencies.

## Requirements

- Persisted data must live under the existing per-user tool folder `~/.tool-agents/mic-tool-ts/`.
- The persisted file must use mode `0600`; the folder must use mode `0700`.
- Only non-secret push-to-talk settings may be persisted.
- Invalid persisted push-to-talk state must raise an explicit typed configuration error rather than being silently ignored.
- Renderer settings loaded for UI must use persisted push-to-talk settings unless the in-memory current settings are newer during the same UI process.
- Existing session argument generation must not include push-to-talk settings, because push-to-talk is a UI control feature rather than a CLI transcription setting.

## Constraints

- Follow the existing strict validation style in `src/protocol/settingsStore.ts`.
- Keep `mic-tool-ts` as the supported user-facing invocation.
- Do not add fallback configuration behavior for required settings.
- Preserve current hotkey normalization and validation rules.

## Acceptance Criteria

- Reopening `mic-tool-ts ui` restores the previous push-to-talk enabled state.
- Reopening `mic-tool-ts ui` restores the previous hotkey accelerator.
- Invalid persisted UI state fails explicitly with a typed configuration error.
- `pnpm typecheck`, focused UI tests, and `pnpm test` pass.
- Documentation records the persistence behavior.

## Assumptions

- "Push-to-talk setting" includes both the boolean enabled state and the configured hotkey.
- Persisting these settings on each UI settings update is sufficient because the renderer sends updates as controls change.

## Open Questions

None.

## Original Request

> I want you also to persist the push-to-talk setting from session to session.


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
