# Investigation: Hotkey Transcription Overlay

Access date: 2026-05-21

## Executive Summary

Build the requested bottom-center recording/transcription indicator as a second Electron `BrowserWindow` owned by the existing `mic-tool-ts ui` main process. The window should subscribe to the same typed session events already sent to the main UI, appear only for hotkey-owned recording/transcription activity, update live partial text in place, commit final text briefly, and hide without stealing focus from the foreground app.

This is an overlay/window-management feature, not a transcription feature. The existing hotkey flow, warmed session, audio gate, `UiRenderer`, and `SessionEvent` pipeline already provide the state and text needed by the overlay.

## Context

Refined request: `docs/reference/refined-request-hotkey-transcription-overlay.md`
Codebase scan: `docs/reference/codebase-scan-hotkey-transcription-overlay.md`

The user wants an independent window at the bottom center of the computer screen, visually similar to the supplied screenshot: a compact wide bar with a recording/level indicator, a small status label, live partial text, hotkey cue, and action/status area. It must not be part of the current main UI layout and must remain useful while the user is focused in another application.

Current implementation facts:

- `src/ui/electronMain.ts` owns the Electron app lifecycle, main `BrowserWindow`, global hotkey manager, warmed hotkey session, and session-event routing.
- `src/ui/globalHotkeyManager.ts` provides system-wide press/release behavior using Electron `globalShortcut` plus `uiohook-napi`.
- `src/core/sessionRunner.ts` emits typed events through `onEvent`, gates real audio with `AudioGate`, and commits pending utterances on hotkey release.
- `src/core/sessionEvents.ts` already defines `capture.state`, `transcript.partial`, `transcript.final`, `transcript.refined`, diagnostics, and session lifecycle events.
- `src/render/uiRenderer.ts` converts renderer calls into typed transcript events.
- `src/ui/renderer/app.ts` already renders live partial text in the main UI capture bar, proving the necessary event data exists.

Electron provides the primitives this needs: `BrowserWindow` creates independent windows; `frame: false` supports frameless windows; `transparent: true` supports shaped overlay-style windows with platform limitations; `screen` exposes display work areas for bottom-center positioning; `focusable`, `skipTaskbar`, `alwaysOnTop`, and non-activating show behavior can keep the surface out of the user's task flow.

## Options

### Option A: Separate Electron Overlay BrowserWindow

Create a second `BrowserWindow` from `src/ui/electronMain.ts` or a small `src/ui/transcriptionOverlay.ts` manager. Load a dedicated local renderer file, for example `dist/ui/renderer/overlay.html`, and send it filtered `SessionEvent` payloads.

Expected window characteristics:

- `show: false`
- `frame: false`
- `transparent: true` if visual verification confirms it is reliable on macOS
- `resizable: false`
- `movable: false`
- `fullscreenable: false`
- `skipTaskbar: true`
- `focusable: false` if the overlay is display-only
- `alwaysOnTop: true`, with a conservative level such as `floating` or `status`
- bottom-center bounds computed from `screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea`
- shown with non-activating behavior so the focused application remains focused

Pros:

- Best match for "independent from the current tool UI."
- Reuses the existing Electron main process, settings, hotkey lifecycle, and event stream.
- Works while the main UI is hidden, behind other apps, or not focused.
- Keeps UI security conventions: local packaged renderer, sandbox, context isolation, no Node integration.
- Easy to test by isolating an overlay state reducer/event router.

Cons:

- Requires more Electron window lifecycle code.
- macOS window level, transparent-window behavior, and multi-display placement require visual verification.
- If the overlay has clickable controls, a non-focusable click-through display-only window is not enough; that product choice changes the window options.

### Option B: Main UI Renderer Overlay Panel

Add a fixed-position panel inside the existing main UI `BrowserWindow`, styled to look like the screenshot.

Pros:

- Lowest implementation cost.
- Reuses existing `src/ui/renderer/app.ts` state directly.
- Minimal new window-management risk.

Cons:

- Does not satisfy the independence requirement.
- Only visible when the main UI window is visible and not covered.
- Not useful when dictating into another app, which is the central push-to-talk workflow.

### Option C: OS-Native macOS Floating Panel Helper

Create a native Swift/AppKit helper or use an `NSPanel`-style helper for a true macOS floating overlay.

Pros:

- Best theoretical native behavior for non-activating panels and macOS-specific window levels.
- Could eventually match system overlay behavior more closely than Electron.

Cons:

- Introduces non-TypeScript production surface and packaging complexity.
- Conflicts with the project preference for TypeScript tool work unless the native behavior is truly required.
- Requires additional permission, signing, and lifecycle investigation.
- Overkill for the first overlay implementation because Electron can already host the app UI and receives the necessary events.

### Option D: Notification/Toast API

Use OS notifications or Electron notification APIs to indicate recording and transcript progress.

Pros:

- Very low custom UI work.
- Native notification placement and accessibility behavior.

Cons:

- Poor fit for live partial transcript replacement.
- User cannot rely on bottom-center placement.
- Notifications can be delayed, grouped, muted, or persisted by the OS, which is undesirable for private live transcript text.

## Comparison Matrix

| Criterion | Separate `BrowserWindow` | Main UI panel | Native macOS helper | Notification/toast |
|---|---:|---:|---:|---:|
| Independent from main UI | High | Low | High | Medium |
| Live partial text fit | High | High | High | Low |
| Existing event-flow fit | High | High | Medium | Low |
| macOS focus behavior | Medium | Low | High | Medium |
| Visual fidelity to screenshot | High | Medium | High | Low |
| Implementation complexity | Medium | Low | High | Low |
| Testability | High | High | Medium | Low |
| Privacy control | High | High | Medium | Low |
| Risk to hotkey/session behavior | Low | Low | Medium | Low |

## Recommendation

Use Option A: a separate Electron overlay `BrowserWindow` controlled by the existing Electron main process.

This gives the requested independent bottom-center surface while preserving the current architecture. `electronMain.ts` should remain the single owner of hotkey state and session ownership. A new overlay manager should receive the same `SessionEvent` objects as the main UI, derive overlay state from them, and send only display-safe event payloads to the overlay renderer.

Recommended implementation shape:

1. Add `src/ui/transcriptionOverlay.ts`.
2. Add local overlay renderer assets, such as:
   - `src/ui/renderer/overlay.html`
   - `src/ui/renderer/overlay.ts`
   - `src/ui/renderer/overlay.css`
3. Update the build script to copy or compile the overlay renderer assets into `dist/ui/renderer/`.
4. In `electronMain.ts`, create the overlay manager after `app.whenReady()` and before hotkey configuration.
5. Change `emitSessionEvent()` so it still sends events to `mainWindow`, and also calls `overlay.handleSessionEvent(event, context)`.
6. Keep overlay show/hide tied to hotkey-owned sessions, not manual Start/Stop sessions.

## Expected Overlay State Model

The overlay can be implemented as a small state reducer independent from DOM rendering:

| Input | Overlay state | Display behavior |
|---|---|---|
| `capture.state: warm` | `warm` | Hidden by default, unless product decision says to show "ready" while warm. |
| `capture.state: recording` | `recording` | Show bottom-center. Label: `LIVE PARTIAL`. Text: latest partial or `Waiting for audio...`. |
| `transcript.partial` while recording | `recording` | Replace live text with the latest partial. Do not append every partial. |
| `transcript.final` while hotkey capture active/recent | `finalizing` | Commit final text, optionally change label to `FINAL`. |
| `transcript.refined` | `processed` | Optional: show processed output briefly only if it does not disrupt focused-input delivery. |
| `diagnostic.warning` during hotkey session | `warning` | Show warning status briefly without persisting transcript text. |
| `session.state: stopping/stopped/error` | `hiding` or `error` | Hide immediately on normal stop; show a short error state for failures. |
| `app before-quit/window-all-closed` | `closed` | Destroy overlay window and timers. |

## Show/Hide Behavior

Recommended defaults:

- Show on `capture.state: recording`.
- Do not show for warmed idle state by default. Warm state can remain visible in the main UI, while the overlay is reserved for active recording/transcription.
- Do not show for manual Start/Stop listening sessions, unless a later request explicitly asks for that.
- While recording, update the text area with `transcript.partial` by replacement.
- On `transcript.final`, show final text and keep the overlay visible until release processing finishes or for a short fixed linger, such as 800-1200 ms.
- On hotkey release before final text arrives, keep showing the latest partial as a finalizing state until either final text arrives or the linger timeout expires.
- On `capture.state: warm` after release, start the linger timer rather than hiding instantly.
- On `session.error` or warning tied to the hotkey path, show the error/warning state briefly, then hide.
- On app shutdown, destroy the overlay without persisting its text.

Open product decisions:

- Whether to show the overlay during `warm`.
- Exact linger duration after release.
- Whether the overlay should include a clickable stop button. If yes, it should be focusable and not fully click-through; if no, it can be display-only and less intrusive.
- Multi-display rule: cursor display, main-window display, primary display, or focused-app display.

## Text Behavior

- Partial text should replace the previous partial in place.
- Final text should replace the partial or be visually promoted, not appended as a full transcript history.
- Long text should wrap to two lines and clamp/fade after that to keep the overlay stable.
- The overlay should not store transcript text in `ui-state.json`, logs, or other files.
- The overlay renderer should clear text on hide and on new capture start.
- If no text has arrived yet, show `Waiting for audio...`.

## Placement

Use Electron `screen` work-area data to avoid the menu bar and Dock:

- Choose display:
  - Preferred first pass: display nearest cursor at the moment recording starts.
  - Alternative: display containing the main window if users expect the overlay near the tool.
  - Primary display fallback if neither is available.
- Compute bounds:
  - Width: fixed target around 900-1000 DIP, capped to `workArea.width - 32`.
  - Height: about 88-112 DIP.
  - X: `workArea.x + (workArea.width - width) / 2`.
  - Y: `workArea.y + workArea.height - height - 24`.
- Recompute on `display-metrics-changed`, `display-added`, and `display-removed`.

## Focus And Interaction

The first implementation should be display-only:

- Show without activating the app.
- Prefer `focusable: false` and `skipTaskbar: true`.
- Consider `setIgnoreMouseEvents(true)` if visual verification confirms clicks pass through cleanly and the overlay has no controls.
- If the overlay includes a stop button, do not use click-through mode and verify that clicking it does not break the user's focused-input workflow.

## Privacy And Security

- Do not persist transcript text, refined text, protocol events, provider endpoints, or secrets.
- Do not expose API keys to the overlay renderer.
- Keep renderer security aligned with the main UI: local packaged files, `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, and a narrow preload bridge.
- The overlay should be event-driven and display-only; it should not invoke transcription or settings APIs unless a later product decision adds controls.

## Likely Files To Touch Later

In scope for implementation:

- `src/ui/electronMain.ts`
- `src/ui/transcriptionOverlay.ts`
- `src/ui/preload.cts` or a new overlay-specific preload file
- `src/ui/shared.ts` if overlay settings are added
- `src/ui/renderer/overlay.html`
- `src/ui/renderer/overlay.ts`
- `src/ui/renderer/overlay.css`
- `scripts/build-native-helper.mjs` or `package.json` build script if renderer asset copying needs to include overlay files
- `tests/ui-transcription-overlay.test.ts`
- `test_scripts/` visual/manual verification helper if needed
- `README.md`
- `docs/tools/mic-tool-ts.md`
- `docs/design/project-functions.md`
- `docs/design/project-design.md`

Out of scope:

- `src/mic/`
- `src/soniox/`
- `src/elevenlabs/`
- `src/transcription/`
- `src/render/renderer.ts`
- `native/macos/input-helper/`

## Verification Plan For Later Implementation

Focused automated checks:

- Unit-test overlay state transitions from `capture.state`, transcript, warning, stop, and error events.
- Unit-test event routing so the main window and overlay both receive events without duplicate side effects.
- Unit-test placement calculations for primary display, cursor display, narrow display, and work-area changes.
- Unit-test privacy behavior: overlay state reset on hide and no transcript persistence patch.

Commands:

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

Visual/manual checks:

- Launch `mic-tool-ts ui`, enable push-to-talk, focus another app, press the hotkey, and confirm the overlay appears bottom-center without stealing focus.
- Verify live partial replacement, final text promotion, and hide/linger behavior.
- Verify long text wrapping and no overlap between status, text, hotkey cue, and action/status controls.
- Verify light/dark mode, reduced motion, and reduced transparency.
- Verify multi-display placement.

## Technical Research Guidance

No separate technical research is required before a first implementation if the first pass uses a display-only Electron overlay. Additional technical research is only warranted if product requirements change to require exact macOS `NSPanel` behavior, focused-app display detection beyond Electron `screen` heuristics, or clickable controls that must never disturb focus.

## References

- Electron `BrowserWindow`: https://www.electronjs.org/docs/latest/api/browser-window
- Electron custom window styles: https://www.electronjs.org/docs/latest/tutorial/custom-window-styles
- Electron `screen`: https://www.electronjs.org/docs/latest/api/screen
- Electron `BaseWindowConstructorOptions`: https://www.electronjs.org/docs/latest/api/structures/base-window-options
- Existing investigation: `docs/reference/investigation-system-wide-command-backtick-hotkey.md`
- Existing Electron UI investigation: `docs/reference/investigation-010-electron-ui-implementation.md`
- Refined request: `docs/reference/refined-request-hotkey-transcription-overlay.md`
- Codebase scan: `docs/reference/codebase-scan-hotkey-transcription-overlay.md`

## Assumptions

- The overlay is for `mic-tool-ts ui` push-to-talk mode.
- The overlay should use the existing typed event stream and should not create a second STT or protocol pipeline.
- The first implementation can be display-only.
- The screenshot is a visual direction, not an exact pixel specification.

## Open Questions

- Should the overlay be visible while warm/ready but not recording?
- How long should final text remain visible after hotkey release?
- Should the overlay include interactive controls, or should it be a display-only indicator?
- Which display should own placement on multi-monitor setups?
- Should users be able to disable the overlay independently from push-to-talk?

## Original Request

> Great, now I want you to look into how, when I use the hotkey for recording and transcription, a window can appear at the bottom of the screen, in the center, that looks like this one here
>
> So that the user understands that there is a recording and transcription in progress and can see the text as it is being recorded and transcribed.
>
> When I refer to the bottom of the screen, I mean a window at the bottom of the computer screen that will be independent from the user interface of the tool we currently have.


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
