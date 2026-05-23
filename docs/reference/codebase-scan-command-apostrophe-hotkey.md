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
last_scanned_commit: null
request_file: docs/reference/refined-request-command-apostrophe-hotkey.md
scan_scope: request-driven UI hotkey default and key matching
generated_at: 2026-05-20
---

# Codebase Scan: Command-Apostrophe UI Hotkey

## Module Map

- `src/ui/shared.ts` — owns shared renderer settings, default UI settings, settings validation, and conversion of UI settings into CLI-equivalent session arguments.
- `src/ui/hotkey.ts` — owns accelerator parsing, canonical formatting, focused-window event matching, and release detection.
- `src/ui/globalHotkeyManager.ts` — owns the optional `uiohook-napi` system-wide keydown/keyup path and native key-code mapping.
- `src/ui/electronMain.ts` — creates/configures `GlobalHotkeyManager`, handles focused-window fallback events with `before-input-event`, and starts/stops hotkey-owned sessions.
- `src/ui/renderer/app.ts` — owns the renderer-side settings form, demo defaults, and renderer fallback hotkey handling.
- `tests/ui-hotkey.test.ts`, `tests/ui-global-hotkey-manager.test.ts`, and `tests/ui-settings.test.ts` — focused coverage for parser normalization, native global hook behavior, and default settings.

## Integration Points

In scope:
- `src/ui/shared.ts` — update the authoritative default `RendererSettings.hotkey`.
- `src/ui/renderer/app.ts` — update the renderer fallback/demo default.
- `src/ui/hotkey.ts` — add apostrophe/quote aliases and DOM `KeyboardEvent.code === "Quote"` support.
- `src/ui/globalHotkeyManager.ts` — map parsed apostrophe key to `UiohookKey.Quote`.
- `tests/ui-hotkey.test.ts` — update and extend parser normalization coverage.
- `tests/ui-global-hotkey-manager.test.ts` — update native key fixture and global keydown/keyup coverage.
- `tests/ui-settings.test.ts` — update default hotkey assertion.
- `README.md`, `docs/tools/mic-tool-ts.md`, `docs/design/project-functions.md`, and `docs/design/project-design.md` — update user-facing and design references to the default hotkey.

Out of scope:
- Session runner, transcription providers, protocol controller, and renderer transcript rendering. The hotkey already calls existing start/stop paths.
- Adding new configuration tiers or a durable UI preferences store.

## Duplication Check

The configurable UI hotkey and system-wide manager already exist. The requested work is an extension of the existing hotkey parser/defaults and native key mapping, not a parallel implementation.

## Conventions Observed

- UI settings validation rejects invalid hotkey strings through shared normalization in `src/ui/shared.ts`.
- System-wide hotkey startup failures are warnings, preserving focused-window fallback behavior.
- Tests are TypeScript/Vitest files under `tests/`; standalone scripts belong under `test_scripts/`, but no new script is needed for this change.


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
