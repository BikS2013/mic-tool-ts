---
language: TypeScript
framework: Electron renderer with vanilla DOM TypeScript
package_manager: pnpm
build_command: pnpm run build
test_command: pnpm test
lint_command: null
entry_points:
  - src/ui/electronMain.ts
  - src/ui/renderer/app.ts
  - src/core/sessionEvents.ts
last_scanned_commit: 207979f
request_file: docs/reference/refined-request-ui-hotkey-warm-status.md
scan_scope: request-driven push-to-talk warm/recording UI state
generated_at: 2026-05-21T04:22:22Z
---

# Codebase Scan: UI Hotkey Warm Status

## Module Map

- `src/ui/electronMain.ts` owns hotkey session state, starts warmed sessions, opens/closes `HotkeySessionControl`, and emits UI session events.
- `src/core/sessionEvents.ts` defines the typed event union delivered to the UI.
- `src/ui/renderer/app.ts` maps typed session events to local UI state and labels the session chip/button.
- `src/ui/renderer/styles.css` styles state-specific indicators.
- `test_scripts/verify-ui-bridge.cjs` verifies packaged renderer behavior.
- `docs/design/project-functions.md` and `docs/design/project-design.md` describe UI behavior.

## Integration Points

### In-Scope

- `src/ui/electronMain.ts`: emit explicit capture-state events when the warmed session is ready, hotkey gate opens, hotkey gate closes, and hotkey session exits.
- `src/core/sessionEvents.ts`: add a typed event for capture mode.
- `src/ui/renderer/app.ts`: parse the new event and map `warm` to a non-recording status/button label and `recording` to active capture.
- `src/ui/renderer/styles.css`: add warmed visual state separate from running.
- `test_scripts/verify-ui-bridge.cjs`: inject capture-state events and assert labels.

### Out-of-Scope

- `src/core/sessionRunner.ts` audio-gate behavior.
- STT provider implementations.
- Protocol operator behavior after release.

## Duplication Check

The backend already has the correct runtime distinction through `HotkeySessionControl.open()` / `close()`, but the renderer only has `running`. There is no typed UI event that carries warmed idle versus active push-to-talk recording.


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
