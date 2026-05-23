# Plan 008: Electron UI Command

## Status

Implemented 2026-05-16. The production implementation keeps this plan's shared session runner, UI event sink, Electron shell, and preload security model. Plan 009 supersedes the original visual direction.

Related artifacts:

- Refined request: `docs/design/request-014-electron-ui-command.md`
- Investigation: `docs/reference/investigation-008-electron-ui-command.md`
- Visual mockup: `docs/design/plan-008-electron-ui-command-visual.html`
- Implementation research: `docs/reference/investigation-010-electron-ui-implementation.md`

## Goal

Add `mic-tool-ts ui` as an Electron-based macOS-style interface for monitoring and controlling an active transcription session. UI mode renders human transcript text, partials, finals, readiness, warnings, and session status inside the window instead of in the console.

## Design Target

The current host reports macOS 26.4.1 build 25E253, so the visual target is macOS Tahoe 26's Liquid Glass-era design language:

- A native-feeling macOS window with traffic lights.
- A translucent sidebar/control layer over content.
- Clear separation between functional controls and transcript content.
- Subtle state transitions and motion.
- System font, compact density, familiar macOS controls, and high legibility.
- Reduced-transparency and reduced-motion compatibility.

Electron can approximate this using macOS `BrowserWindow` vibrancy plus CSS. It should not be described as exact AppKit/SwiftUI Liquid Glass parity.

## Recommended Architecture

### Current Shape

Today `src/main.ts` owns both session orchestration and terminal rendering:

```text
resolveConfig
  -> StdoutRenderer
  -> VoiceAgentProtocolController
  -> Transcriber callbacks
  -> process.stdout / process.stderr
```

This is correct for CLI mode but not for UI mode because UI mode must not render transcript text in the console.

### Target Shape

Refactor toward one shared session runner and two frontends:

```text
mic-tool-ts                 mic-tool-ts ui
    |                            |
 CLI frontend                Electron frontend
    |                            |
 stdout/stderr sinks         UI event sinks over IPC
    \__________ shared transcription session runner _________/
                 |
       config -> transcriber -> protocol controller -> render sink
                 |
              mic source
```

The shared runner should own the current operational sequence:

1. Resolve configuration.
2. Warn about credential expiry.
3. Restore protocol settings.
4. Create render, diagnostics, and protocol sinks.
5. Create refiner/translator.
6. Create transcriber.
7. Start STT provider session.
8. Start microphone.
9. Wire audio to the transcriber.
10. Handle shutdown.
11. Persist protocol settings.

The CLI frontend supplies stdout/stderr sinks. The Electron frontend supplies IPC-backed sinks.

## Proposed Module Layout

Suggested future files:

```text
src/cli/main.ts
src/core/sessionRunner.ts
src/core/sessionEvents.ts
src/core/diagnostics.ts
src/render/stdoutRenderer.ts
src/render/uiRenderer.ts
src/ui/electronMain.ts
src/ui/preload.ts
src/ui/renderer/
src/ui/renderer/index.html
src/ui/renderer/styles.css
src/ui/renderer/app.ts
```

Notes:

- `src/main.ts` can remain as a compatibility wrapper during migration, but the implementation should move out of the CLI-specific file.
- `StdoutRenderer` should remain available for normal CLI mode.
- `UiRenderer` should implement the existing `Renderer` interface and emit typed session events to Electron.
- The Electron renderer must never import Node modules or read secrets directly.

## Command Contract

The proposed user-facing invocation is:

```text
mic-tool-ts ui
```

The existing invocation remains unchanged:

```text
mic-tool-ts
```

Development commands such as package-manager scripts are not user-facing invocation methods and should remain absent from user documentation.

## UI Mode Rendering Contract

When the UI is active:

- Partial transcript text appears in the transcript pane as an active live line.
- Final transcript text is committed into the conversation timeline.
- Turn boundaries and refined/translated outputs appear in the timeline.
- Provider warnings, credential-expiry warnings, mic errors, and protocol warnings appear in UI status/log surfaces.
- `stdout` does not receive human transcript text.
- `stderr` is only used for fatal bootstrap errors before the UI can display them, or as a last-resort crash diagnostic.

This implies that startup readiness must become a session event in UI mode rather than the current unconditional `process.stderr.write(...)`.

## Event Model

Define a UI-facing event union separate from raw Electron IPC messages:

```text
session.ready
session.started
session.stopping
session.stopped
session.error
transcript.partial
transcript.final
transcript.turnBoundary
transcript.refined
protocol.event
protocol.status
diagnostic.warning
diagnostic.info
audio.level
config.loaded
config.saved
```

The UI should render these events directly. It must not parse terminal output.

## Configuration Design

The UI should edit the same configuration surface the CLI already supports:

- STT provider: Soniox or ElevenLabs.
- Provider API key and expiry date.
- Model.
- Endpoint.
- Languages.
- Sample rate.
- Endpoint detection.
- Output/display mode.
- Guard phrase.
- Protocol markers and operator defaults.
- Translation policy.
- LLM refinement toggle, provider, and model.
- Verbose diagnostics.

Resolution rules stay aligned with the existing four-tier chain:

1. UI runtime values for the active session, equivalent to explicit CLI flags.
2. `<cwd>/.env`.
3. `~/.tool-agents/mic-tool-ts/.env`.
4. Shell environment.

The UI must clearly show whether a value is configured, inherited, or missing. Missing required values must block session start with the existing typed error behavior; the UI must not substitute placeholder defaults for required settings.

Persisting settings should be explicit:

- Secrets: write to `~/.tool-agents/mic-tool-ts/.env` with mode `0600`, inside a `0700` folder.
- Non-secret preferences: either write to a dedicated UI preferences file under `~/.tool-agents/mic-tool-ts/` or update the per-user `.env` after an explicit Save action.
- Protocol runtime settings continue to use `~/.tool-agents/mic-tool-ts/state.json`.

## Electron Main Process Design

The Electron main process should own:

- App lifecycle.
- Single-instance lock.
- `BrowserWindow` creation.
- Native menu bar.
- Session runner lifecycle.
- File IO and settings persistence.
- Credential handling.
- Microphone/session start and stop.
- Clipboard and focused-input operations.
- IPC registration.

Recommended `BrowserWindow` characteristics:

- `titleBarStyle: "hiddenInset"` or `"hidden"`.
- `trafficLightPosition` tuned to the custom toolbar height.
- macOS `vibrancy` such as `"sidebar"` or `"under-window"`.
- `visualEffectState: "followWindow"`.
- Transparent or near-transparent background.
- `show: false` plus `ready-to-show`, or an appropriate `backgroundColor`, to avoid first-paint flash.
- `webPreferences` with `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, and a preload script.

## Preload And IPC Design

Expose a narrow preload API:

```text
loadSettings()
saveSettings(settingsPatch)
startSession(configPatch)
stopSession()
onSessionEvent(callback)
onConfigError(callback)
```

Security rules:

- Do not expose `ipcRenderer` directly.
- Validate payloads on both preload and main-process boundaries.
- Namespace channels, for example `ui:session:start`, `ui:session:stop`, `ui:settings:load`, `ui:event`.
- Renderer content is local packaged content only.
- Use a restrictive Content Security Policy.
- Disable arbitrary navigation and new windows.

## Renderer UI Design

The first screen should be the application itself, not a marketing page.

Recommended layout:

- Left sidebar:
  - Session state.
  - Provider selector.
  - Monitor, Settings, Protocol, Logs navigation.
  - Start/Stop control.
- Top toolbar:
  - Native traffic lights on the left.
  - Current provider/model/language summary.
  - Mic and connection indicators.
- Main transcript pane:
  - Live partial line pinned near the bottom.
  - Finalized transcript timeline above it.
  - Refined/translated sections visually distinct from raw finals.
- Right inspector:
  - Session settings.
  - Protocol operators.
  - Credential status.
  - Audio/input status.
- Bottom status strip:
  - Latency, sample rate, endpoint detection, protocol mode, last warning.

The standalone mockup uses this structure.

## Dependency And Packaging Considerations

Electron is a large runtime dependency. The implementation pass must decide whether to:

- Add `electron` as a runtime dependency so `mic-tool-ts ui` works from the installed package.
- Split the UI into a companion package later if CLI package size becomes unacceptable.

For the first implementation, prefer one package and one user-facing command unless package size becomes a hard constraint.

Before editing `package.json`:

1. Re-check the latest stable Electron release.
2. Check security advisories for the candidate version.
3. Pin to a caret range against the vetted version.
4. Run the project audit command.
5. Record the decision in `Issues - Pending Items.md` under the dependency-vetting log.

The investigation observed `electron@42.1.0` as the npm latest version on 2026-05-16, but this must be verified again immediately before implementation.

## Implementation Phases

### Phase 1: Core Refactor

- Extract the current orchestration from `src/main.ts` into a shared session runner.
- Introduce explicit sink interfaces for rendering, diagnostics, protocol events, and lifecycle status.
- Keep CLI behavior byte-compatible where practical.
- Add focused unit tests around CLI mode to ensure stdout/stderr behavior does not regress.

### Phase 2: UI Event Adapter

- Implement `UiRenderer` against the existing `Renderer` interface.
- Add typed `SessionEvent` definitions.
- Route partials, finals, refined outputs, turn boundaries, warnings, and readiness through the UI event stream.
- Ensure UI mode does not write transcript text to stdout.

### Phase 3: Electron Shell

- Add Electron main process, preload bridge, and local renderer assets.
- Create a macOS-style window with vibrancy, hidden/inset titlebar, native traffic lights, and a native menu bar.
- Implement Start/Stop lifecycle and settings load/save.
- Keep all secrets and filesystem operations in the main process.

### Phase 4: Settings And Monitor UI

- Build the monitor, settings, protocol, and logs views.
- Add validation messages using the same config parser semantics.
- Add credential expiry display and warnings.
- Add operator state display and protocol status.

### Phase 5: Verification

- Unit test the session runner with fake mic/transcriber sinks.
- Unit test that UI mode emits events instead of stdout transcript text.
- Unit test preload payload validation.
- Add a manual smoke script under `test_scripts/` only if a script is needed.
- Verify UI screenshots on macOS light/dark mode, reduced transparency, and reduced motion.
- Run `pnpm typecheck`, the relevant tests, and `pnpm audit --audit-level=high`.

## Acceptance Criteria For Implementation

- `mic-tool-ts ui` opens the Electron UI on macOS.
- The user can start and stop a live transcription session from the UI.
- The UI can configure every existing major setting without bypassing existing validation.
- Missing required config is shown as a typed configuration failure; no fallback value is invented.
- Transcript partials/finals render in the UI and do not appear on stdout.
- CLI mode still renders exactly as before.
- Electron renderer has no Node integration, uses context isolation, and communicates through a narrow preload API.
- The UI visibly approximates macOS Tahoe 26 styling with vibrancy/translucency, native traffic lights, and restrained motion.

## Risks

- Electron cannot exactly reproduce native Liquid Glass. The plan targets a close approximation using native macOS vibrancy plus web rendering.
- Electron significantly increases package size and update/security maintenance burden.
- Refactoring `main()` can regress CLI stream behavior unless tests lock the old behavior down first.
- UI settings persistence can accidentally conflict with the four-tier config chain if the source of each value is not displayed clearly.
- Microphone permission and Accessibility permission flows remain macOS-owned and may need UI copy that explains the permission boundary.

## Open Questions

- Should the UI auto-start listening after launch when required settings are present?
- Should the first implementation include protocol JSONL export controls?
- Should secrets be editable inline or through a dedicated credential sheet?
- Should UI preferences live in `.env`, `state.json`, or a separate `ui-preferences.json` file?


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
