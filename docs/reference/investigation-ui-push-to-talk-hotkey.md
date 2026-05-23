# Investigation: UI Push-To-Talk Hotkey

## Executive Summary

Use UI-focused keyboard handling for the first implementation. Electron's `globalShortcut` API is designed around registering accelerators that invoke a callback when pressed, but it does not provide a paired key-release event. Push-to-talk needs a reliable release signal, so a focused-window keyboard-event approach is lower risk and does not require a new native dependency. The implementation should document that the first version works while the Electron UI has keyboard focus.

## Context

The refined request at `docs/reference/refined-request-ui-push-to-talk-hotkey.md` asks for a configurable hotkey available through `mic-tool-ts ui`. Press starts capture/transcription; release stops capture and runs downstream processing.

The existing UI already starts and stops the shared `runMicSession()` path through IPC. The shared session runner already finalizes the transcriber on stop, then ends the protocol/refinement pipeline.

## Options

### Option A: Electron `globalShortcut`

Register a process-level accelerator in Electron main.

Pros:

- Can work even when the Electron window is not focused.
- Uses built-in Electron API.

Cons:

- The public API exposes registration callbacks for accelerator activation, not key-release lifecycle.
- Push-to-talk requires release detection; adding that globally would require extra native/event-tap machinery or a third-party module.
- Global shortcuts can conflict with system and app shortcuts.

### Option B: UI-focused keyboard events

Detect keydown/keyup events in the Electron renderer window and call the existing start/stop IPC methods.

Pros:

- Detects both press and release directly.
- No new runtime dependency.
- Easy to validate and test with pure TypeScript hotkey parsing/matching.
- Scoped to the UI feature as requested.

Cons:

- Requires the Electron UI window to have focus.
- Does not behave as a background dictation daemon.

### Option C: Add a native global key event dependency

Use an external package or OS event tap to observe global keydown/keyup.

Pros:

- Could support true global push-to-talk including release.

Cons:

- Adds dependency-vetting burden and likely native build/signing/accessibility complexity.
- Larger permission and maintenance surface for a first UI feature.

## Comparison Matrix

| Criterion | `globalShortcut` | UI-focused events | Native/global dependency |
|---|---:|---:|---:|
| Key release support | Low | High | High |
| No new dependency | High | High | Low |
| Global behavior | High | Low | High |
| Implementation risk | Medium | Low | High |
| Fits "UI feature" scope | Medium | High | Medium |
| Testability | Medium | High | Medium |

## Recommendation

Implement Option B: UI-focused keyboard events with a typed shared hotkey parser. This satisfies the required press/release semantics without adding dependencies or changing the CLI. If the next requirement is "works while any app is focused," revisit Option C as a separate request because it changes permissions, dependency risk, and runtime behavior.

## Technical Research Guidance

No separate deep technical research is required. The implementation should use a small local parser for the accelerator subset supported by the UI and reject invalid combinations before they are registered or matched.

## Implementation Considerations

- Add `hotkeyEnabled` and `hotkey` to `RendererSettings`.
- Keep the default combination explicit, for example `CommandOrControl+Shift+Space`.
- Reject invalid hotkey text in `mergeRendererSettings()`.
- Renderer keydown starts a hotkey-owned session only once.
- Renderer keyup stops only a hotkey-owned session and requests pending-section processing on shutdown.
- Manual Start/Stop remains independent.

## References

- Electron `globalShortcut` API, accessed 2026-05-20: https://www.electronjs.org/docs/latest/api/global-shortcut
- Electron `webContents` `before-input-event`, accessed 2026-05-20: https://www.electronjs.org/docs/latest/api/web-contents#event-before-input-event

## Assumptions

- UI-focused push-to-talk is acceptable for the first implementation.
- The UI setting can remain runtime-only because the current UI settings mechanism is not a durable UI preferences store.

## Open Questions

- Should a later version support global push-to-talk while another app is focused?
- Should a later version add a durable UI preferences store for hotkey settings?

## Original Request

> I want you to add aconfigurable hotkey combination/feature 
> that will capture and transcribe the voice while the hotkey is pressed, 
> and proceed with any further processing and use e.g. refinement transcription, etc., after the hotkey release. 
> So I want the hotkey to be used as the signal of starting voice capturing, and the hotkey release to be used as a signal for processing the captured, the transcribed content. 
> I want you to make it available upon the use of the UI feature.


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
