---
language: TypeScript
framework: Electron CLI
package_manager: pnpm
build_command: pnpm build
test_command: pnpm test
lint_command: null
typecheck_command: pnpm typecheck
entry_points:
  - src/index.ts
  - src/main.ts
  - src/ui/electronMain.ts
  - src/ui/renderer/index.html
last_scanned_commit: f64f221691e8e525374a18305bc3b74471de6bdc
request_file: docs/reference/refined-request-hotkey-transcription-overlay.md
scan_scope: request-driven hotkey transcription overlay investigation
generated_at: 2026-05-21
---

# Codebase Scan: Hotkey Transcription Overlay

## Summary

`mic-tool-ts` is a TypeScript CLI plus Electron UI. The requested bottom-center recording/transcription overlay should extend the existing Electron UI process, global hotkey manager, warmed hotkey session lifecycle, and typed `SessionEvent` stream. No duplicate microphone capture, STT client, protocol controller, or renderer pipeline is needed.

The feature is partially supported already: the app emits `capture.state`, `transcript.partial`, `transcript.final`, `transcript.refined`, session lifecycle, and diagnostic events from the shared session runner. The missing surface is an independent overlay window and a routing layer that sends those events to that window even when the main UI is hidden or unfocused.

## Module Map

- `src/index.ts` — CLI entrypoint. Dispatches `mic-tool-ts ui` to the Electron launcher and normal invocations to CLI main.
- `src/ui/launcher.ts` — Electron UI launch wrapper.
- `src/ui/electronMain.ts` — Electron main process. Owns the main `BrowserWindow`, IPC registration, settings load/update handlers, `GlobalHotkeyManager`, hotkey warm-session lifecycle, capture-state emission, and session-event delivery to the renderer.
- `src/ui/globalHotkeyManager.ts` — system-wide hotkey adapter combining Electron `globalShortcut` press registration with `uiohook-napi` keydown/keyup release handling.
- `src/ui/hotkey.ts` — pure accelerator parsing and DOM/native event matching.
- `src/ui/shared.ts` — shared renderer settings, defaults, validation, start/stop option types, and preload API contract.
- `src/ui/preload.cts` — narrow IPC bridge exposed to sandboxed renderer code.
- `src/ui/renderer/index.html` — main UI DOM. Contains the existing bottom capture bar and live partial text.
- `src/ui/renderer/app.ts` — main UI renderer state, settings form, transcript rendering, session-event parsing, capture-state handling, and focused-window hotkey fallback.
- `src/ui/renderer/styles.css` — main UI styles, including the existing capture bar and recording/warm state styling.
- `src/core/sessionRunner.ts` — shared session runner for CLI/UI. Emits typed events and gates real audio for warmed hotkey sessions.
- `src/core/sessionEvents.ts` — authoritative typed session-event vocabulary, including capture and transcript event types.
- `src/render/uiRenderer.ts` — adapts transcription renderer calls into typed `SessionEvent` objects for UI mode.
- `src/protocol/controller.ts` and `src/protocol/stateMachine.ts` — voice-agent protocol and pending-section processing used after hotkey release.

## Current Hotkey And Event Flow

1. `src/ui/electronMain.ts` creates `GlobalHotkeyManager` and registers callbacks for hotkey press/release.
2. When push-to-talk is enabled, `reconcileHotkeyWarmSession()` starts a hotkey-owned warmed session.
3. `HotkeySessionControl` implements `AudioGate`; while warm, `isOpen()` is false and `sessionRunner` sends silence instead of real mic chunks.
4. `startHotkeySession()` opens the gate and emits `capture.state: recording`.
5. `stopHotkeySession()` closes the gate, emits `capture.state: warm`, and calls `stopSession({ submitPending: true })`, which commits and submits pending utterance text without tearing down the warmed session.
6. `runMicSession()` emits typed `SessionEvent` objects through `onEvent`.
7. `UiRenderer` emits `transcript.partial`, `transcript.final`, `transcript.turnBoundary`, and `transcript.refined`.
8. `emitSessionEvent()` currently sends each event only to `mainWindow?.webContents`.

## Existing UI Behavior Relevant To Overlay

- The main renderer already shows live partial transcript text in the footer capture bar via `#liveText`.
- `renderTranscript()` updates `liveText` from `state.partial?.text ?? "Waiting for audio..."`.
- `handleEvent()` maps `capture.state` values into renderer session states: `warm`, `recording`, and `idle`.
- The main renderer can parse the same typed events that the overlay needs, but its UI is tied to the main window layout.

## Conventions Observed

- Renderer content is packaged as static local files under `src/ui/renderer/` and copied into `dist/ui/renderer/` during `pnpm build`.
- Electron renderers run with `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, and a narrow preload bridge.
- User-facing UI state is non-secret and persisted through `src/ui/settingsStore.ts`; transcript text and secret values are not persisted.
- Session state is event-driven; UI code should consume typed `SessionEvent` objects rather than parse stdout/stderr.
- Hotkey-owned sessions must remain separate from manual sessions.
- Configuration validation rejects invalid values instead of silently falling back.

## Integration Points

### In Scope

- `src/ui/electronMain.ts`
  - Add overlay `BrowserWindow` lifecycle.
  - Route selected `SessionEvent` objects to both main and overlay windows.
  - Decide show/hide behavior from `capture.state`, session stop/error events, and transcript events.
  - Compute bottom-center display bounds using Electron `screen`.

- `src/ui/preload.cts`
  - Optionally reuse the current `onSessionEvent` bridge for overlay renderer delivery.
  - If the overlay needs only one-way events and no settings mutation, keep exposed API narrower than the main UI bridge.

- `src/ui/shared.ts`
  - Add overlay-specific non-secret settings only if product decisions require them, such as enabled/disabled or linger duration.
  - Preserve existing strict validation style.

- `src/ui/renderer/`
  - Prefer a separate overlay renderer file set, such as `overlay.html`, `overlay.ts`, and `overlay.css`, so the main UI layout remains independent.
  - Reuse event parsing/state concepts from `app.ts` where practical without coupling to main UI DOM.

- `src/core/sessionEvents.ts`
  - Likely no change needed. Existing events are sufficient unless implementation needs explicit overlay-only metadata.

- `tests/`
  - Add focused tests for overlay state derivation and event routing helpers.
  - Existing `tests/ui-global-hotkey-manager.test.ts`, `tests/ui-renderer.test.ts`, and `tests/main.test.ts` show test style.

- `test_scripts/`
  - Add any manual/Electron visual verification script here if an implementation needs a script.

### Out Of Scope

- STT provider adapters under `src/soniox/`, `src/elevenlabs/`, and `src/transcription/`.
- Microphone source implementation under `src/mic/`.
- Voice-agent protocol behavior except for consuming existing processed/refined events.
- Focused input native helper under `native/macos/`.
- CLI stdout renderer behavior under `src/render/renderer.ts`.

### New Integration Point

- Add an overlay renderer surface under `src/ui/renderer/overlay.*` or a sibling `src/ui/overlay/` module. It should be loaded by a second Electron `BrowserWindow`, not embedded in the existing main window.

## Duplication Check

The requested overlay is not currently implemented. A bottom capture bar exists inside the main UI, but it is structurally part of the existing main `BrowserWindow` and depends on the main UI being visible. The implementation should extend existing hotkey/session-event paths and create a separate overlay surface rather than duplicating transcript capture or adding a second pipeline.

## Likely Verification Commands

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- Focused Vitest runs for any new overlay state/event tests.
- Electron visual verification after implementation, including bottom-center placement, no focus stealing, live partial updates, final text handling, and hide behavior.

## Risks And Notes

- macOS focus behavior is the main risk. The overlay should be shown without activating the Electron app or stealing focus from the foreground app.
- Multi-display placement needs an explicit product decision. Best implementation default is the display containing the cursor or currently focused app if available; otherwise primary display.
- Transparent/frameless Electron windows have platform limitations and should be visually verified on macOS.
