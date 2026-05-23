# Investigation: System-Wide Command-Backtick Push-To-Talk Hotkey

## Executive Summary

Use a native global input hook for system-wide push-to-talk. Electron `globalShortcut` can trigger a callback while the app is not focused, but it does not provide a key-release event, which is required for press-and-hold capture. `uiohook-napi` provides system-wide `keydown` and `keyup` events through libuiohook and is the best fit for the requested behavior.

## Context

The current UI push-to-talk implementation uses focused-window input handling through Electron main plus a renderer fallback. The new request requires the hotkey to work while another app has focus and changes the default hotkey to `Command+\``.

## Options

### Option A: Electron `globalShortcut`

Pros:

- Built into Electron.
- No new dependency.
- Works while the app is not focused.

Cons:

- Does not expose keyup/release events.
- Cannot implement true push-to-talk hold/release semantics without another release detector.

### Option B: Native global keyboard hook through `uiohook-napi`

Pros:

- Provides system-wide keydown and keyup events.
- Uses N-API native bindings and ships prebuilt binaries for darwin arm64/x64.
- Allows the existing session start/stop path to remain unchanged.

Cons:

- Adds a runtime native dependency.
- macOS may require Accessibility/Input Monitoring permissions.
- Native hook errors must be fail-open to keep the UI usable.

### Option C: Custom macOS event tap helper

Pros:

- Could be tailored exactly to this project.
- Avoids third-party runtime hook dependency.

Cons:

- Requires non-TypeScript helper code, build integration, permissions handling, and maintenance.
- Higher implementation and packaging risk than a maintained N-API package.

## Comparison Matrix

| Criterion | Electron `globalShortcut` | `uiohook-napi` | Custom event tap |
|---|---:|---:|---:|
| System-wide activation | High | High | High |
| Key release support | Low | High | High |
| No new dependency | High | Low | Medium |
| TypeScript integration | High | High | Low |
| Build/package risk | Low | Medium | High |
| Time-to-value | High | Medium | Low |

## Recommendation

Use `uiohook-napi@^1.5.5` for global keydown/keyup and keep the existing focused-window handler as a fallback. Treat native hook startup failures as UI warnings, not fatal errors. This gives true system-wide push-to-talk while preserving manual Start/Stop and the existing protocol submission path.

## Technical Research Guidance

- Electron `globalShortcut` is still useful for non-hold shortcuts, but it is insufficient for this request because release is not represented in the API.
- `uiohook-napi` exposes `uIOhook.on("keydown" | "keyup", ...)` and keyboard event objects with modifier booleans and numeric key codes.
- The implementation should isolate the native dependency behind a small adapter so unit tests can exercise matching/session behavior without starting a real OS hook.

## Implementation Considerations

- Add a `GlobalHotkeyManager` in Electron main code.
- Dynamically import `uiohook-napi` so the UI can warn and continue if the native module fails to load.
- Map `Command+\`` to macOS key code `50` for the backquote key and use the existing modifier parser for Command.
- Start the global hook when the Electron app is ready and settings are loaded.
- Reconfigure the global manager whenever UI settings change.
- Stop the global manager before quit.

## References

- Electron `globalShortcut` API: https://www.electronjs.org/docs/latest/api/global-shortcut
- Electron `webContents.before-input-event`: https://www.electronjs.org/docs/latest/api/web-contents#event-before-input-event
- `uiohook-napi` npm package and README: https://www.npmjs.com/package/uiohook-napi
- `uiohook-napi` GitHub repository: https://github.com/SnosMe/uiohook-napi

## Assumptions

- The user's primary environment is macOS.
- The app can request or rely on the required macOS permissions when the global hook starts.

## Open Questions

- Whether `Command+\`` conflicts with frontmost-app behavior enough to need a different default later.

## Original Request

> I want you to change the hotkey to Command-`
> And I want you to make it system-wide, not needed to focus the UI window to activate it.


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
