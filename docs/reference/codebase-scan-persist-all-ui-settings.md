---
language: TypeScript
framework: Electron
package_manager: pnpm
build_command: pnpm build
test_command: pnpm test
lint_command: null
entry_points:
  - src/index.ts
  - src/ui/launcher.ts
  - src/ui/electronMain.ts
last_scanned_commit: bf9c9904a47a6f5ab296a31d843d18491448d3fa
request_file: docs/reference/refined-request-persist-all-ui-settings.md
scan_scope: request-driven Electron UI settings persistence
generated_at: 2026-05-20
---

# Codebase Scan: Persist All UI Settings

## Summary

The UI settings surface is already centralized in `RendererSettings` and all UI edits flow through Electron main's `mic-tool-ts:settings:update` IPC handler. The project now has `src/ui/settingsStore.ts`, but it currently persists only push-to-talk fields. The implementation should extend that store to persist the non-secret editable subset of `RendererSettings`.

## Module Map

- `src/ui/shared.ts` — defines `RendererSettings`, defaults, normalization, `mergeRendererSettings()`, and `settingsToSessionArgs()`. In-scope as the schema/normalization source for persisted UI settings.
- `src/ui/settingsStore.ts` — existing UI state store for push-to-talk. In-scope for extension to full non-secret renderer settings.
- `src/ui/runtimeSettings.ts` — builds renderer settings from resolved config and persisted protocol settings. In-scope for overlaying persisted UI settings and refreshing derived credential status.
- `src/ui/electronMain.ts` — owns `latestSettings` and saves settings on renderer updates. In-scope for saving full UI settings instead of push-to-talk only.
- `tests/ui-settings-store.test.ts` — in-scope for full store tests.
- `tests/ui-runtime-settings.test.ts` — in-scope for UI load restoration tests.
- Docs: README, tool docs, configuration guide, project functions, project design, pending issue log.

## Integration Points

### In Scope

- `src/ui/settingsStore.ts`
  - Add `PersistedUiSettings`.
  - Add `loadPersistedUiSettings()` and `savePersistedUiSettings()`.
  - Keep compatibility wrappers or migration handling for old `push_to_talk`-only files.
- `src/ui/runtimeSettings.ts`
  - Load persisted UI settings before/while constructing renderer settings.
  - Apply persisted UI settings after config/protocol resolution.
  - Recompute credential status after provider restoration.
- `src/ui/electronMain.ts`
  - Save all persisted UI settings after accepted UI updates.

### Out of Scope

- `src/config.ts` — no new env/CLI parameters are required.
- `src/core/sessionRunner.ts` — existing `settingsToSessionArgs()` already turns renderer settings into explicit UI-started session args.
- Renderer DOM code — no new controls are needed.

## Duplication Check

Protocol settings persistence is separate and should remain in `src/protocol/settingsStore.ts`. UI persistence should stay in `src/ui/settingsStore.ts` because it includes provider/model/hotkey/UI choices that are not voice-agent protocol state.

## Recommended Implementation Notes

- Persist only user-editable non-secret fields:
  - `provider`
  - `model`
  - `languages`
  - `sampleRate`
  - `endpointDetection`
  - `protocolMode`
  - `refine`
  - `translate`
  - `clipboard`
  - `focusedInput`
  - `translationPolicy`
  - `llmEnabled`
  - `hotkeyEnabled`
  - `hotkey`
- Do not persist:
  - `apiKeyName`
  - `apiKeyStatus`
  - `expiryStatus`
  - `storageStatus`
  - `inputStatus`
- Reuse `mergeRendererSettings()` for normalization where possible.


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
