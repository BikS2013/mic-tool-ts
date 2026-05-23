# Refined Request: Persist All UI Settings

## Category

Development

## Objective

Persist all non-secret settings changed through the Electron UI across `mic-tool-ts ui` sessions, so reopening the UI restores the user's previous UI configuration.

## Scope

In scope:

- Extend the existing UI state persistence from push-to-talk-only to all non-secret renderer settings.
- Persist UI settings changed through the renderer settings controls: STT provider, model, language hints, sample rate, endpoint detection, protocol mode, operator defaults, translation policy, LLM enablement, push-to-talk enabled state, and push-to-talk hotkey.
- Keep derived credential display fields refreshed from the environment/config chain rather than persisted as settings.
- Load persisted UI settings during `mic-tool-ts ui` startup and apply them to the displayed settings and next session args.
- Save persisted UI settings on every accepted UI settings update.
- Preserve strict validation and explicit errors for invalid persisted UI state.
- Update tests and documentation.

Out of scope:

- Persisting API key values, provider endpoints, transcript text, protocol events, processed output, or diagnostics.
- Adding new UI controls.
- Changing the CLI/environment configuration resolution chain for normal CLI runs.
- Adding runtime dependencies.

## Requirements

- Persisted UI settings must be stored under `~/.tool-agents/mic-tool-ts/ui-state.json`.
- The per-user tool folder must use mode `0700`, and the UI state file must use mode `0600`.
- The persisted file must contain only non-secret user-editable UI settings.
- Credential status fields (`apiKeyName`, `apiKeyStatus`, `expiryStatus`, `storageStatus`) must be recomputed when settings load, because they are derived from current env/config state.
- Invalid persisted UI state must produce a typed configuration error rather than being silently ignored.
- Existing push-to-talk-only `ui-state.json` files must remain readable so recently persisted push-to-talk preferences are not lost.
- UI-persisted settings should override config-derived defaults in UI mode because they represent explicit prior UI edits.

## Constraints

- Follow the existing strict persistence style used by `src/protocol/settingsStore.ts` and `src/ui/settingsStore.ts`.
- Do not introduce hidden configuration fallback behavior.
- Keep `mic-tool-ts` as the supported user-facing command.
- Do not persist secrets.

## Acceptance Criteria

- Reopening `mic-tool-ts ui` restores all non-secret settings changed through the UI.
- The next UI-started session uses the restored settings via existing explicit session args.
- Existing push-to-talk-only UI state remains readable.
- Invalid persisted UI state is reported as `InvalidConfigurationError`.
- Focused UI store/runtime tests cover full-state persistence and restoration.
- `pnpm typecheck`, focused tests, `pnpm build`, and `pnpm test` pass.

## Assumptions

- "All settings changes through the UI" means all user-editable renderer settings, not derived credential display fields.
- Persisting UI choices separately from `.env` is acceptable because these choices are UI-runtime preferences.

## Open Questions

None.

## Original Request

> I want you to persist all the settings changes happened through the ui 
> from session to session


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
