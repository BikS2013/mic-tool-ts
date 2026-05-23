# Plan 009: Modern macOS UI Review

## Status

Implemented 2026-05-16. The production renderer assets under `src/ui/renderer/` apply this visual direction with light mode, dark mode, reduced-motion, and reduced-transparency support.

Related artifacts:

- Refined request: `docs/design/request-016-modern-macos-ui-review.md`
- Investigation: `docs/reference/investigation-009-modern-macos-ui-review.md`
- Previous visual: `docs/design/plan-008-electron-ui-command-visual.html`
- Revised visual: `docs/design/plan-009-modern-macos-ui-visual.html`
- Implementation research: `docs/reference/investigation-010-electron-ui-implementation.md`

## Goal

Refresh the proposed `mic-tool-ts ui` visual direction so it feels more modern and closer to recent macOS while preserving Plan 008's architecture and UI-mode rendering contract.

## Review Summary

The Plan 008 implementation approach is still the right direction: one shared session runner, CLI sinks for terminal mode, UI event sinks for Electron mode, and a restricted preload bridge. The visual layer needs adjustment.

The existing mockup communicates the feature set but overuses frosted surfaces. Because the window, sidebar, toolbar, message rows, live strip, right inspector, and footer all use similar glass effects, the hierarchy becomes weaker than a current macOS app should feel. The design also includes normal-view copy about console suppression and UI event sinks, which is technically correct but too implementation-oriented for the main product surface.

## Revised Visual Strategy

Use a content-first macOS utility layout:

- Transcript is the primary content plane.
- Navigation and high-level controls sit in a translucent sidebar/control layer.
- The top toolbar is compact, draggable, and leaves room for native traffic lights.
- The right inspector is a calm settings/status surface, not a stack of dashboard cards.
- The bottom capture bar owns live audio state, partial text, and the Start/Stop action.
- Implementation diagnostics move to a logs/events view instead of appearing as prominent product copy.

## Concrete Design Changes

- Replace the decorative gradient desktop with a quiet system-like background.
- Reserve space for native traffic lights instead of drawing them as web UI in production.
- Reduce the number of glass surfaces. Use blur/translucency mainly on sidebar, toolbar, segmented controls, and capture controls.
- Keep transcript rows on a stable content material for readability.
- Use a denser macOS inspector style for settings: label/value rows, pop-up-like controls, switches, and warning rows.
- Add a reduced-transparency mode in CSS that disables heavy blur and increases background opacity.
- Keep reduced-motion handling for status animations and audio meters.

## Revised Mockup Notes

`docs/design/plan-009-modern-macos-ui-visual.html` is a standalone HTML design artifact. It is not production Electron code. It intentionally uses simple CSS-only controls and placeholders so the file can be opened directly without dependencies.

The mockup represents:

- Current session state and provider summary.
- Transcript finals and processed operator output.
- A live partial capture bar.
- Provider, protocol, credential, and permission state.
- A settings/inspector surface with explicit missing-config and expiry signals.

## Implementation Guidance For A Future Pass

- Keep Plan 008's Electron security model: local packaged content, no Node integration, context isolation, sandboxing, restrictive CSP, and narrow preload APIs.
- Use `BrowserWindow` with `titleBarStyle: "hiddenInset"` or `"hidden"`, tuned `trafficLightPosition`, macOS vibrancy, and `visualEffectState: "followWindow"`.
- Let the Electron main process own secrets, mic capture, STT sessions, focused-input delivery, and file IO.
- Keep renderer text focused on user tasks and state. Put internal stream-routing details in logs and documentation.
- Electron dependency vetting was repeated during implementation and recorded in `Issues - Pending Items.md`.

## Acceptance Criteria For The Visual Direction

- The app still opens directly into the monitoring/configuration experience.
- The transcript remains the most legible, visually stable area.
- Glass-like effects support hierarchy instead of dominating the whole screen.
- The design has explicit light, dark, reduced-motion, and reduced-transparency handling.
- The future implementation can still satisfy the Plan 008 rendering contract: UI-active human text renders in the UI, not stdout.

## Open Questions

- Should the production UI use a persistent inspector or a sheet-based settings flow?
- Should credentials be edited inline, or only in a dedicated credential sheet?
- Should the default monitor tab show raw transcript chronology, submitted command sections, or a split view?


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
