# Refined Request: Hotkey Transcription Overlay Investigation

## Category
Research

## Objective
Investigate how `mic-tool-ts` can show an independent bottom-center overlay window whenever the existing UI push-to-talk hotkey starts recording/transcription. The investigation must determine how such a window can be integrated with the current Electron UI, global hotkey, warmed session, and typed session-event pipeline so it can indicate recording/transcription progress and display live transcribed text without depending on the current main UI window layout.

## Scope
- **In scope**:
  - Investigate feasible approaches for an independent bottom-center recording/transcription window in the existing `mic-tool-ts ui` Electron application.
  - Identify integration points in the current push-to-talk flow, including hotkey press/release handling, warmed hotkey sessions, `capture.state` events, and `transcript.partial` / `transcript.final` events.
  - Define the expected behavior of the overlay while idle, warm, recording, receiving partial transcripts, committing final transcripts, encountering warnings/errors, and ending a push-to-talk capture.
  - Evaluate how the overlay can remain independent from the existing main UI while still using the current shared session runner and typed event stream.
  - Consider macOS-specific window behavior for bottom-center placement, focus behavior, always-on-top or floating behavior, multi-display behavior, reduced motion/transparency, and not stealing focus from the foreground application.
  - Identify testing and verification needs, including unit tests for event routing/state transitions and UI/browser-style verification for overlay visibility, placement, text updates, and non-overlap.
- **Out of scope**:
  - Implementing the overlay window.
  - Changing the core speech-to-text provider behavior, transcription model behavior, LLM refinement pipeline, protocol operators, clipboard delivery, or focused-input delivery.
  - Replacing the existing main Electron UI.
  - Adding new runtime dependencies unless a later implementation plan explicitly vets them under the project dependency-vetting policy.
  - Persisting transcript text, screenshots, protocol events, processed output, or secret credential values.

## Requirements
1. The investigation MUST describe the current UI push-to-talk architecture relevant to the overlay, including `src/ui/electronMain.ts`, `src/ui/globalHotkeyManager.ts`, `src/core/sessionEvents.ts`, `src/render/uiRenderer.ts`, and `src/ui/renderer/app.ts`.
2. The investigation MUST evaluate at least two feasible implementation approaches for an independent overlay, such as a separate Electron `BrowserWindow` controlled by the existing main process and alternatives that reuse or extend the current renderer surface.
3. The investigation MUST compare candidate approaches against independence from the main UI, implementation complexity, event-flow fit, macOS focus behavior, visual fidelity, testability, accessibility, and risk to the existing hotkey/session behavior.
4. The investigation MUST specify the overlay's expected state model using existing concepts where possible: `idle`, `warm`, `recording`, `transcript.partial`, `transcript.final`, `transcript.refined`, `diagnostic.warning`, and session stop/error events.
5. The investigation MUST define how live transcribed text should appear in the overlay during push-to-talk recording, including partial-text replacement behavior, final-text commitment, long-text wrapping, and what happens on hotkey release.
6. The investigation MUST define when the overlay should be shown and hidden, including behavior for warmed idle sessions, active recording, recording release, manual Start/Stop sessions, failed hotkey setup, session errors, and app shutdown.
7. The investigation MUST account for the overlay being independent from the current tool UI, meaning it should not require the main window to be focused, visible, or structurally modified to display recording progress.
8. The investigation MUST identify privacy constraints: the overlay MUST NOT persist transcript text or secret values, and any UI state persistence MUST remain limited to non-secret preferences already allowed by the project.
9. The investigation MUST identify any configuration or settings surface that may be needed, but MUST NOT require hidden fallback defaults for required configuration values.
10. The investigation MUST identify documentation that would need updates if implemented, including `docs/design/project-design.md`, `docs/design/project-functions.md`, `README.md`, and `docs/tools/mic-tool-ts.md`.
11. The investigation MUST identify verification commands and likely test locations for a later implementation, using the repository's existing TypeScript, Vitest, Electron verification, and `test_scripts/` conventions.
12. The investigation MUST produce a recommendation and note any follow-up technical research required before implementation.

## Constraints
- The project is a TypeScript CLI/Electron application; user-facing invocation remains `mic-tool-ts` and `mic-tool-ts ui`.
- Existing UI mode uses Electron with local packaged renderer content, context isolation, sandboxing, no renderer Node integration, and a narrow preload IPC bridge.
- Existing human UI rendering is driven by typed `SessionEvent` objects, not by parsing stdout/stderr.
- Existing push-to-talk behavior uses the default hotkey `Command+'`, system-wide hotkey registration, a native key-release hook, and warmed sessions that send silence while idle.
- The overlay investigation must preserve the existing separation between manual sessions and hotkey-owned sessions.
- Required configuration values must fail with typed errors when absent; no hidden config fallback may be introduced.
- API keys, provider endpoints, transcript text, protocol events, and processed section content must not be stored in UI persistence files.
- Any future new runtime dependency must be vetted before being added, with audit results and dependency-vetting notes recorded according to project policy.
- The referenced screenshot is not available in the current request context; the investigation should use the textual target of an independent bottom-center in-progress transcription window unless the screenshot is supplied later.

## Acceptance Criteria
1. A research or investigation document is created under `docs/reference/` and is self-contained enough for a planner or implementer to proceed without re-reading the raw request.
2. The investigation identifies current code integration points for hotkey state, session state, transcript events, and renderer delivery.
3. The investigation includes a comparison of at least two implementation approaches and recommends one with a clear rationale.
4. The recommended approach explains how the overlay can appear independently at the bottom center while recording/transcription is in progress and update with live transcribed text.
5. The recommended approach explicitly states how it avoids focus stealing, hidden transcript persistence, secret exposure, and disruption to the existing main UI.
6. The investigation documents expected show/hide behavior and state transitions for warm, recording, release, stop, and error cases.
7. The investigation lists concrete files likely to be touched by a future implementation and files that should remain out of scope.
8. The investigation lists focused tests and verification steps suitable for a later implementation phase.
9. Any unresolved product/design decisions are captured as open questions rather than silently decided.

## Assumptions
- The requested window is intended for `mic-tool-ts ui` push-to-talk usage, not for the headless `mic-tool-ts` CLI mode.
- "Independent from the current tool UI" means a separate visible window/surface controlled by the Electron main process, not a panel inside the existing main UI layout.
- The overlay should appear primarily while the hotkey is actively recording and may hide shortly after release unless a later product decision keeps final text visible longer.
- The overlay should consume the existing typed session events rather than introduce a second transcription pipeline.
- The screenshot's design intent can be approximated from the textual description as a compact, bottom-center progress/transcript overlay until the screenshot is available.

## Open Questions
- The referenced screenshot is not present in the current context. What exact visual dimensions, styling, animation, and text layout should be matched?
- Should the overlay appear during warmed-but-idle push-to-talk state, or only after the hotkey is pressed and real microphone audio is being sent?
- After hotkey release, should the overlay disappear immediately, remain until final text is committed, or linger for a fixed duration?
- Should users be able to disable or configure the overlay, or is it mandatory whenever push-to-talk is enabled?
- On multi-monitor setups, should the overlay appear on the display containing the focused app, the display containing the main Electron window, or the primary display?

## Original Request
The user wants to investigate how, when they use the hotkey for recording/transcription, an independent bottom-center window can appear like the provided screenshot, showing that recording/transcription is in progress and displaying live transcribed text as it is recorded. This window should be independent from the current tool UI.
