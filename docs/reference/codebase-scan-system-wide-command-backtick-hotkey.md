---
language: TypeScript
framework: Electron + Node.js CLI
package_manager: pnpm
build_command: pnpm build
test_command: pnpm test
lint_command: null
entry_points:
  - src/index.ts
  - src/ui/electronMain.ts
  - src/ui/renderer/app.ts
last_scanned_commit: null
request_file: docs/reference/refined-request-system-wide-command-backtick-hotkey.md
scan_scope: request-driven system-wide UI push-to-talk hotkey
generated_at: 2026-05-20
---

# Codebase Scan: System-Wide Command-Backtick Hotkey

## Metadata Notes

- Git commit was not queried because project instructions say not to perform version-control operations unless explicitly requested.
- Generated output and vendor directories were excluded.

## Module Map

- `src/ui/shared.ts` owns `RendererSettings`, `DEFAULT_RENDERER_SETTINGS`, UI settings normalization, and conversion to CLI-equivalent session args.
- `src/ui/hotkey.ts` owns accelerator parsing and focused-window keyboard-event matching.
- `src/ui/electronMain.ts` owns the Electron window, UI settings state, session start/stop, and focused-window push-to-talk input handling.
- `src/ui/renderer/app.ts` owns the settings form and fallback renderer-side push-to-talk handling.
- `src/core/sessionRunner.ts` maps UI abort reasons to protocol end-session behavior.
- `src/protocol/stateMachine.ts` can drain a pending section as `section.submitted` when the hotkey release path requests pending submission.
- `tests/ui-hotkey.test.ts` and `tests/ui-settings.test.ts` cover current hotkey parsing and settings normalization.

## Integration Points

### In Scope

- `package.json` and `pnpm-lock.yaml` — add vetted native hook dependency.
- `src/ui/shared.ts` — change default hotkey to `Command+\``.
- `src/ui/hotkey.ts` — support backquote canonicalization and native hook key-code matching.
- `src/ui/globalHotkeyManager.ts` — new adapter for `uiohook-napi`, isolated from Electron window code and testable with a fake hook implementation.
- `src/ui/electronMain.ts` — instantiate and configure the global manager, emit hook warnings, and preserve focused-window fallback.
- `tests/ui-hotkey.test.ts` and a new focused global-manager test — cover default/matching behavior.
- Documentation under `docs/design`, `docs/tools`, `README.md`, and `Issues - Pending Items.md`.

### Out Of Scope

- CLI-only `mic-tool-ts` behavior.
- STT, LLM, microphone, renderer output modes, and protocol operator internals except the already-existing submit-on-release path.
- App packaging/signing/login-item behavior.

## Duplication Check

No existing system-wide hook module exists. The focused-window hotkey path exists in `src/ui/electronMain.ts` and `src/ui/renderer/app.ts`; the new global manager should call the same start/stop functions and avoid duplicating transcription/session logic.
