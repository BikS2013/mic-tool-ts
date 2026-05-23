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
request_file: docs/reference/refined-request-ui-push-to-talk-hotkey.md
scan_scope: request-driven UI push-to-talk hotkey integration
generated_at: 2026-05-20
---

# Codebase Scan: UI Push-To-Talk Hotkey

## Metadata Notes

- Git commit was not queried because the project instructions say not to perform version control operations unless explicitly requested.
- Generated and vendor output such as `dist/` and `node_modules/` was excluded.

## Module Map

### CLI and UI entry

- `src/index.ts` dispatches `mic-tool-ts ui` to the Electron launcher and all other invocations to CLI main.
- `src/ui/launcher.ts` launches the compiled Electron main script.
- `src/ui/electronMain.ts` owns the Electron app lifecycle, window creation, IPC handlers, latest UI settings, and calls into `runMicSession()`.

### Shared UI settings

- `src/ui/shared.ts` defines `RendererSettings`, `DEFAULT_RENDERER_SETTINGS`, `mergeRendererSettings()`, `normalizeRendererSettings()`, and `settingsToSessionArgs()`.
- `src/ui/runtimeSettings.ts` resolves startup UI settings from the same CLI configuration chain and refreshes credential status without exposing secrets.
- `src/ui/preload.cts` exposes the context-isolated IPC bridge as `window.micToolTs`.

### Renderer UI

- `src/ui/renderer/index.html` contains settings, protocol controls, monitor timeline, event log, and manual Start/Stop button.
- `src/ui/renderer/app.ts` owns renderer state, settings parsing, form synchronization, live transcript rendering, event handling, and manual session toggling.
- `src/ui/renderer/styles.css` contains the macOS-style UI layout and responsive state styling.

### Shared session runner and protocol

- `src/core/sessionRunner.ts` resolves config, creates renderer/protocol/transcriber/mic objects, starts capture, handles UI aborts, stops microphone/transcriber, and calls `renderer.endSession(reason)`.
- `src/protocol/controller.ts` wraps rendering plus protocol state, processes submitted sections with refine/translate/clipboard/input operators, and drains state on session end.
- `src/protocol/stateMachine.ts` buffers finalized text and currently cancels pending buffered text on shutdown through `drainForShutdown()`.

### Existing tests

- `tests/ui-settings.test.ts` covers shared renderer settings and session arg conversion.
- `tests/ui-runtime-settings.test.ts` covers startup settings resolution and credential-status refresh.
- `tests/ui-renderer.test.ts` covers UI renderer event emission.
- `tests/protocol.test.ts` covers protocol section submission, operator behavior, and shutdown handling.

## Conventions

- UI settings are typed in shared code and duplicated minimally in preload/renderer because the renderer is context-isolated.
- UI settings updates cross IPC via `mic-tool-ts:settings:update`, then Electron main validates with `mergeRendererSettings()`.
- UI sessions are controlled through `mic-tool-ts:session:start` and `mic-tool-ts:session:stop`.
- The UI does not receive API-key values; it receives only status/source metadata.
- Missing required runtime configuration remains fatal; optional UI preferences use explicit defaults.
- Tests prefer pure units over launching Electron.

## Integration Points

### In Scope

- `src/ui/shared.ts` — add hotkey settings fields and validation; ensure hotkey values do not become CLI session args.
- `src/ui/renderer/app.ts` — add hotkey state, parse hotkey settings, bind keydown/keyup events, and call start/stop with hotkey-specific options.
- `src/ui/renderer/index.html` — add enable and accelerator controls to the UI settings surface.
- `src/ui/renderer/styles.css` — add minimal styling for the new controls/status if needed.
- `src/ui/preload.cts` — update exposed API types so `stopSession()` can carry hotkey release options.
- `src/ui/electronMain.ts` — let UI stop requests carry whether pending buffered text should be submitted for processing.
- `src/core/sessionRunner.ts` — interpret UI abort reason and request submit-on-stop behavior from the protocol controller.
- `src/protocol/controller.ts` and `src/protocol/stateMachine.ts` — add a submit-pending-on-end path so hotkey release can process captured text instead of cancelling it as a normal shutdown.
- `tests/ui-settings.test.ts` — cover hotkey validation and session args.
- `tests/protocol.test.ts` — cover submit-pending shutdown behavior.

### Out Of Scope

- CLI-only behavior for `mic-tool-ts` without the `ui` subcommand.
- STT provider adapters under `src/soniox/`, `src/elevenlabs/`, and `src/transcription/`.
- Microphone implementation under `src/mic/`.
- LLM provider implementation under `src/llm/`.

### New Integration Point

- `src/ui/hotkey.ts` — pure TypeScript hotkey parser/matcher shared by renderer code and tests.

## Duplication Check

No existing push-to-talk hotkey module was found. The closest existing behavior is manual Start/Stop in `src/ui/renderer/app.ts` and `src/ui/electronMain.ts`, plus protocol submission by spoken `command send`. The feature should extend these existing paths rather than introduce a parallel transcription pipeline.


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
