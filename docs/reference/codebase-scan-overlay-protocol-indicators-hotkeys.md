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
  - src/ui/renderer/overlay.html
last_scanned_commit: f64f221691e8e525374a18305bc3b74471de6bdc
request_file: docs/reference/refined-request-overlay-protocol-indicators-hotkeys.md
scan_scope: request-driven overlay protocol indicators and hotkeys
generated_at: 2026-05-21
---

# Codebase Scan: Overlay Protocol Indicators And Hotkeys

## Summary

The requested feature extends existing functionality rather than creating a new pipeline. `mic-tool-ts` already has a hotkey-owned warmed session, typed `SessionEvent` delivery, protocol operator state, and an independent overlay window. The missing pieces are protocol-feature state in overlay snapshots and a runtime control path from secondary hotkeys to the active `VoiceAgentProtocolController`.

## Module Map

- `src/ui/electronMain.ts` - Electron main process. Owns main and overlay windows, IPC, global hotkey manager, warmed hotkey session lifecycle, and session-event routing.
- `src/ui/globalHotkeyManager.ts` - System-wide push-to-talk adapter using Electron `globalShortcut` for press reservation and `uiohook-napi` for keydown/keyup observation.
- `src/ui/hotkey.ts` - Pure accelerator parsing and DOM/native event matching used by both main and renderer fallback.
- `src/ui/transcriptionOverlay.ts` - Overlay `BrowserWindow` manager that reduces session events into snapshots and sends them to the overlay renderer.
- `src/ui/transcriptionOverlayState.ts` - Pure overlay reducer, snapshot model, and bounds calculation.
- `src/ui/renderer/overlay.html`, `overlay.ts`, `overlay.css` - Sandboxed overlay renderer surface.
- `src/ui/renderer/app.ts` - Main renderer settings, focused-window hotkey fallback, session-event parsing, and UI state rendering.
- `src/ui/shared.ts` and `src/ui/preload.cts` - Shared IPC/preload contracts.
- `src/core/sessionRunner.ts` - Creates `VoiceAgentProtocolController` and wires UI session events, audio gate, and submit-pending control.
- `src/protocol/controller.ts` and `src/protocol/stateMachine.ts` - Protocol operator state, spoken commands, section submission, and protocol events.
- `src/protocol/types.ts` - `OperatorKey`, `OperatorState`, and protocol event vocabulary.
- `tests/ui-transcription-overlay.test.ts`, `tests/ui-global-hotkey-manager.test.ts`, `tests/protocol.test.ts` - Existing focused test locations for this change.

## Current Relevant Behavior

1. UI push-to-talk starts or opens a hotkey-owned session in `src/ui/electronMain.ts`.
2. `HotkeySessionControl` gates real microphone audio while warm and exposes submit-pending listeners for release.
3. `runMicSession()` constructs `VoiceAgentProtocolController` with the initial protocol operators.
4. The controller emits `protocol.event` / `state.changed` when spoken state commands change operators.
5. Electron main routes every typed `SessionEvent` to the main renderer and to `TranscriptionOverlayManager`.
6. The overlay snapshot currently includes visibility, phase, tone, label, detail, text, and dictation hotkey, but not protocol operator state.
7. The global hotkey manager detects the main push-to-talk press/release but does not currently act on secondary keys while pressed.
8. The main renderer fallback starts/stops push-to-talk while focused, but also lacks secondary-key toggle handling.

## Conventions

- Renderer content is static local HTML/CSS/JS copied during `pnpm build`.
- Electron renderers use `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, and a narrow preload bridge.
- UI state flows through typed objects across IPC; terminal output parsing is avoided.
- Protocol operator state changes are represented by `ProtocolEvent` objects, especially `state.changed`.
- Hotkey-owned sessions remain separate from manual sessions.
- Required config must fail explicitly; no hidden fallback values are allowed.

## Integration Points

### In Scope

- `src/protocol/stateMachine.ts`
  - Add a public runtime toggle/set operation that returns the same `state.changed` action shape as spoken commands.

- `src/protocol/controller.ts`
  - Add a public runtime method that toggles an operator and emits the normal protocol event.

- `src/core/sessionRunner.ts`
  - Add a small protocol-toggle subscription option and wire it to the active controller.

- `src/ui/electronMain.ts`
  - Extend `HotkeySessionControl` to publish protocol-toggle requests.
  - Track the latest protocol feature state for overlay context.
  - Add IPC for focused-window fallback protocol toggles.
  - Handle `protocol.event` / `state.changed` to keep UI/overlay state synchronized.

- `src/ui/globalHotkeyManager.ts`
  - Detect `R`, `T`, `C`, and `I` keydown events while the dictation hotkey is pressed.
  - Debounce held secondary keys until keyup.

- `src/ui/shared.ts` and `src/ui/preload.cts`
  - Extend the preload API with a typed protocol toggle method.

- `src/ui/transcriptionOverlayState.ts`
  - Add operator indicators to overlay context and snapshots.
  - Update snapshots when state changes arrive while the overlay is visible.

- `src/ui/renderer/overlay.*`
  - Render compact bottom indicators with enabled/disabled visual states.

- `src/ui/renderer/app.ts`
  - Support focused-window secondary toggles while the dictation hotkey is held.
  - Reflect `state.changed` protocol events in renderer settings controls.

### Out Of Scope

- STT providers under `src/soniox/`, `src/elevenlabs/`, and `src/transcription/`.
- Microphone source implementation under `src/mic/`.
- Focused input helper internals under `src/platform/macos/` and `native/macos/`.
- CLI stdout renderer behavior under `src/render/renderer.ts`.

## Duplication Check

The overlay and protocol operators already exist. This request should extend those modules, not create a separate overlay, transcription pipeline, clipboard path, or input-delivery implementation.

## Verification Commands

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

## Notes

- System-wide secondary hotkeys are observable through the native hook, but the foreground app may still see modifier combinations because `globalShortcut` only reserves the main push-to-talk accelerator. This implementation keeps the existing behavior model and should avoid adding new native dependencies.


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
