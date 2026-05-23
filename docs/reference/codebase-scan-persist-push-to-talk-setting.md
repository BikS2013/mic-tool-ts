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
request_file: docs/reference/refined-request-persist-push-to-talk-setting.md
scan_scope: request-driven Electron UI push-to-talk persistence
generated_at: 2026-05-20
---

# Codebase Scan: Persist Push-To-Talk Setting

## Summary

The Electron UI already has push-to-talk controls and global hotkey wiring. The feature is partially implemented: `hotkeyEnabled` and `hotkey` are stored in memory in Electron main as part of `latestSettings`, but they are not persisted to disk. `loadRendererSettingsForUi()` receives the current in-memory settings and preserves them across config refreshes during one process, but a fresh `mic-tool-ts ui` launch starts from `DEFAULT_RENDERER_SETTINGS`.

## Module Map

- `src/ui/shared.ts` — defines `RendererSettings`, `DEFAULT_RENDERER_SETTINGS`, `settingsFromConfig()`, `mergeRendererSettings()`, and hotkey normalization. In-scope for adding a reusable push-to-talk settings type if helpful.
- `src/ui/runtimeSettings.ts` — loads renderer settings from resolved CLI config and persisted protocol settings. In-scope for applying persisted push-to-talk settings during UI load.
- `src/ui/electronMain.ts` — owns `latestSettings`, IPC settings updates, global hotkey configuration, and session start/stop. In-scope for saving push-to-talk settings on update and loading them before window creation.
- `src/protocol/settingsStore.ts` — existing strict non-secret state persistence pattern for protocol settings. Use as implementation model; do not modify unless sharing helpers becomes necessary.
- `tests/ui-runtime-settings.test.ts` — in-scope for persisted UI setting restoration and invalid persisted state behavior.
- `tests/ui-settings.test.ts` — in-scope for pure settings normalization behavior.
- New `tests/ui-settings-store.test.ts` — likely landing point for focused persistence store tests.
- `docs/design/project-functions.md`, `docs/design/project-design.md`, `Issues - Pending Items.md` — documentation updates.

## Integration Points

### In Scope

- New `src/ui/settingsStore.ts` — load/save `hotkeyEnabled` and `hotkey` under `~/.tool-agents/mic-tool-ts/ui-state.json`.
- `src/ui/runtimeSettings.ts` — apply persisted push-to-talk settings to the current settings before converting resolved config into renderer settings.
- `src/ui/electronMain.ts` — persist push-to-talk settings when settings are updated.

### Out of Scope

- `src/config.ts` — no CLI/env setting is being added.
- `src/core/sessionRunner.ts` — push-to-talk is a UI control feature and does not affect transcription session args.
- Transcription, LLM, protocol state machine, and renderer DOM behavior.

## Duplication Check

No existing UI settings store exists. Protocol settings persistence is separate and should remain focused on voice-agent runtime settings. The new UI store should be a small parallel module using the same file-per-feature pattern and validation approach.

## Recommended Implementation Notes

- Store only:
  - `version`
  - `saved_at`
  - `push_to_talk.enabled`
  - `push_to_talk.hotkey`
- Normalize persisted hotkeys with the existing hotkey parser/normalizer.
- A missing file should return `null`.
- Invalid JSON or invalid shape should raise `InvalidConfigurationError`.
- Apply persisted push-to-talk settings before calling `settingsFromConfig()` so the current settings parameter carries restored values.


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
