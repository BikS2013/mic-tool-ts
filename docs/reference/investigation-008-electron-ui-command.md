# Investigation 008: Electron UI Command

## Executive Summary

`mic-tool-ts ui` is feasible as a macOS-first Electron extension, but it should not be implemented as a shell wrapper around the current CLI output. The current CLI is built around stdout/stderr rendering, and the user's requirement says that UI-active text rendering must happen in the UI. The right implementation path is to refactor the orchestrator into a reusable session runner with injectable render, diagnostics, and lifecycle sinks, then have the Electron main process run that session and forward events to the renderer through a restricted preload bridge.

For the macOS visual target, the current host reports macOS 26.4.1 build 25E253. The relevant Apple design language is macOS Tahoe 26 / Liquid Glass. Electron can approximate the native look by using macOS `BrowserWindow` vibrancy, hidden/inset native traffic lights, transparent backgrounds, and local CSS with `backdrop-filter`, but exact Liquid Glass behavior is native AppKit/SwiftUI territory. The design should acknowledge that boundary rather than overpromise pixel-perfect parity.

## Context

- Project: `mic-tool-ts`.
- Current command: direct OS command `mic-tool-ts`.
- Current runtime: TypeScript, Node.js >= 20.12.
- Current rendering path: `src/main.ts` constructs `StdoutRenderer`, then routes STT partial/final callbacks through `VoiceAgentProtocolController`.
- Existing stream contract:
  - `dictation`: human transcript on stdout.
  - `agent-protocol`: JSONL protocol events on stdout.
  - `hybrid`: human transcript on stdout and JSONL to `--protocol-output`.
- New UI requirement: in UI mode, human transcript rendering belongs in the UI, not the console.

## Research Questions

1. What macOS design system should the UI target?
2. Which Electron capabilities support macOS-style window chrome, translucency, and vibrancy?
3. What Electron security constraints must shape the architecture?
4. How should the current CLI architecture be adapted so the UI receives transcript events directly?
5. What dependency-vetting obligations apply before implementation?

## Sources And Access Date

Access date: 2026-05-16.

- Apple Support, "What's new in the updates for macOS Tahoe 26": https://support.apple.com/en-us/122868
- Apple Newsroom, "Apple introduces a delightful and elegant new software design": https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/
- Apple Human Interface Guidelines, "Materials": https://developer.apple.com/design/human-interface-guidelines/materials
- Apple Human Interface Guidelines, "Layout": https://developer.apple.com/design/human-interface-guidelines/layout
- Apple Human Interface Guidelines, "Buttons": https://developer.apple.com/design/human-interface-guidelines/buttons
- Apple Human Interface Guidelines, "The menu bar": https://developer.apple.com/design/human-interface-guidelines/the-menu-bar
- Apple AppKit, `NSVisualEffectView`: https://developer.apple.com/documentation/appkit/nsvisualeffectview
- Electron, `BrowserWindow`: https://www.electronjs.org/docs/latest/api/browser-window
- Electron raw docs, `base-window-options.md`: https://raw.githubusercontent.com/electron/electron/main/docs/api/structures/base-window-options.md
- Electron raw docs, `custom-title-bar.md`: https://raw.githubusercontent.com/electron/electron/main/docs/tutorial/custom-title-bar.md
- Electron raw docs, `security.md`: https://raw.githubusercontent.com/electron/electron/main/docs/tutorial/security.md
- Electron raw docs, `ipc.md`: https://raw.githubusercontent.com/electron/electron/main/docs/tutorial/ipc.md
- Electron raw docs, `context-isolation.md`: https://raw.githubusercontent.com/electron/electron/main/docs/tutorial/context-isolation.md
- Electron stable releases: https://releases.electronjs.org/releases/stable
- npm package metadata queried with `npm view electron version dist-tags --json`.

## Key Findings

### macOS Tahoe 26 And Liquid Glass

- Apple describes Liquid Glass as a translucent material that reflects and refracts surrounding content, adapts between light and dark environments, and extends across controls, navigation, sidebars, tab bars, text, and media controls.
- Apple's HIG separates Liquid Glass from standard materials. Liquid Glass is intended for controls and navigation layers floating above content, while content-layer backgrounds should generally use standard materials.
- The HIG warns against overusing Liquid Glass. The UI should use it for the sidebar, toolbar, segmented controls, and active controls, not as a dense effect on every content panel.
- Apple layout guidance says controls/navigation appear on top of content and the layout should account for those layers. For this tool, the transcript should be the content plane; toolbar/sidebar controls are the floating functional layer.
- The local host currently reports:

```text
ProductName: macOS
ProductVersion: 26.4.1
BuildVersion: 25E253
```

### Electron Window Capabilities

- Electron `BrowserWindow` supports `titleBarStyle: "hidden"` and `titleBarStyle: "hiddenInset"` on macOS, preserving native traffic-light controls while allowing a full-content window.
- Electron supports `trafficLightPosition` for custom traffic-light placement in frameless/custom-titlebar macOS windows.
- Electron supports macOS `vibrancy` values including `sidebar`, `header`, `window`, `content`, `under-window`, and `under-page`.
- Electron `visualEffectState` controls whether macOS vibrancy follows window focus or remains active/inactive, and it must be used with `vibrancy`.
- Electron `BrowserWindow` can use transparent backgrounds and supports opacity on macOS.
- Electron exposes `win.setVibrancy(type, { animationDuration })`, which can animate fade-in/fade-out of the vibrancy effect but not transitions between different vibrancy types.
- Electron recommends using `ready-to-show` or an appropriate `backgroundColor` to avoid visual flash during first paint.

### Electron Security Constraints

- Electron's security guide emphasizes that Electron apps have more local power than websites and must keep Electron up to date, evaluate dependencies, and adopt secure coding practices.
- Electron recommends local or trusted content, no Node.js integration for renderer content, context isolation, process sandboxing, restrictive CSP, and limited navigation/window creation.
- Electron IPC should expose narrow methods from preload via `contextBridge`; the renderer should not receive the raw `ipcRenderer` object.
- Context isolation is enabled by default since Electron 12 and is recommended for all applications. Electron explicitly warns against exposing unrestricted IPC APIs through preload.

### Dependency State

- `npm view electron version dist-tags --json` reported `latest: 42.1.0` on 2026-05-16.
- Electron stable releases showed `42.1.0` on May 14, 2026, with Chromium 148.0.7778.97 and Node.js 24.15.0.
- The project dependency policy requires current advisory checks before editing `package.json`; this investigation did not add Electron and did not perform a full package audit.

## Options Compared

| Option | Description | Fit | Risk | Recommendation |
|--------|-------------|-----|------|----------------|
| A. Electron main imports shared core | Refactor current orchestrator into a session runner; Electron main owns session and sends events to UI | Best fit for "no console rendering" | Medium refactor | Recommended |
| B. Electron spawns `mic-tool-ts` child process | UI wraps stdout/stderr from existing CLI | Quick prototype | Violates UI rendering intent unless CLI output is heavily suppressed; fragile parsing | Reject |
| C. Native Swift/SwiftUI app | Native macOS shell around Node/STT core | Best visual fidelity | Larger stack, not Electron as requested | Defer unless Liquid Glass parity becomes strict |
| D. Web-only dashboard served by CLI | Browser UI connecting to local server | Lower package size than Electron | Not native app, weaker macOS feel, browser permission/lifecycle concerns | Reject for this request |

## Recommendation

Use Option A: add `mic-tool-ts ui` as an Electron-hosted mode that imports a refactored TypeScript session runner. The current CLI should become one consumer of the runner with stdout/stderr sinks; the Electron command should become another consumer with UI event sinks.

The UI should be macOS-first and use:

- `BrowserWindow` with `titleBarStyle: "hiddenInset"` or `"hidden"` plus `trafficLightPosition`.
- macOS `vibrancy: "sidebar"` or `"under-window"` and `visualEffectState: "followWindow"`.
- Transparent or near-transparent window background.
- Renderer CSS using `backdrop-filter`, system fonts, system colors, subtle motion, and `prefers-reduced-motion` support.
- A native menu bar with standard macOS menu ordering.

## Derived Implementation Decisions

- Do not parse stdout to drive the UI. Transcript, status, diagnostics, and protocol events should be explicit typed events.
- Keep `StdoutRenderer` for CLI mode. Add a UI renderer/event adapter for UI mode.
- In UI mode, avoid using `stdout` for human text entirely. Console output is acceptable only for fatal startup errors before the UI exists.
- Keep provider sessions in the Electron main process, not the renderer, because API keys, file IO, mic capture, child processes, clipboard, and AppleScript must not be exposed to web content.
- Keep renderer content local and packaged. No remote scripts, no remote CSS, no remote images.
- Use a restricted preload bridge:
  - `startSession(configPatch)`
  - `stopSession()`
  - `loadSettings()`
  - `saveSettings(settingsPatch)`
  - `onSessionEvent(callback)`
  - `onConfigError(callback)`
- Do not expose raw `ipcRenderer`.
- Treat UI-supplied values as explicit runtime config, equivalent to CLI flags. Persist only after explicit user action unless a later product decision says otherwise.
- Before implementation, dependency-vet Electron again and record the result in `Issues - Pending Items.md`.

## Open Questions

- Should the first UI release auto-start when configuration is complete?
- Should secrets be editable in the same Settings window, or should the UI direct users to a dedicated credential sheet?
- Should UI mode support protocol JSONL export in v1?
- Should the UI show raw JSONL protocol events in a developer pane?

## Original Request

> I want you to consider adding the command `ui` to the tool, which will create an Electron-based UI.
> The UI will allow the user to configure the settings and parameters and at the same time monitor the progress of the ongoing conversation (transcribe).
>
> When the tool’s UI is active, text rendering should happen there and not in the console.
>
> It is also important that the look and feel of the tool’s UI be very close to the look and feel of macOS, specifically the version we are currently on. It should have all those transparencies and animations supported by the design system proposed by the current version of macOS.
>
> I don’t want you to write code for me. I just want you to prepare and describe in a document the implementation approach and, possibly, also prepare some kind of visual that shows roughly what we expect it to look like. The visual must be in HTML; I don’t want it to be an embedded visual inside a markdown file.
