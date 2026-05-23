# Refined Request: Modern macOS UI Review

## Category

Design review and documentation.

## Objective

Review the proposed Electron UI visual design for `mic-tool-ts ui` and revise the design direction so it feels more modern and closer to the recent macOS aesthetic, while preserving the existing architecture, configuration, and UI-mode rendering requirements from Plan 008.

## Scope

In scope:

- Review the existing standalone HTML mockup in `docs/design/plan-008-electron-ui-command-visual.html`.
- Identify concrete visual and interaction issues that make the mockup feel less like recent macOS.
- Produce a revised standalone HTML mockup that explores a more modern macOS-like direction.
- Keep the work documentation-only; do not implement Electron production code.
- Update project design and functional requirement docs to reference the revised visual direction.

Out of scope:

- No Electron dependency changes.
- No production renderer, preload, or main-process implementation.
- No package installation or build tooling changes.
- No final pixel-perfect claim of AppKit, SwiftUI, or Liquid Glass parity.

## Requirements

- Preserve the proposed user-facing invocation `mic-tool-ts ui`.
- Preserve the Plan 008 architecture: shared session runner, CLI sinks, UI event sinks, and restricted Electron preload bridge.
- Treat the transcript as the primary content plane.
- Use translucent, glass-like treatment primarily for navigation and control layers, not every content panel.
- Avoid fake in-app educational copy about implementation details unless it belongs in logs or diagnostics.
- Use native-feeling macOS density, typography, toolbar structure, status controls, and inspector/form patterns.
- Include reduced-motion and reduced-transparency handling in the mockup CSS.

## Constraints

- The visual artifact must remain a standalone HTML file under `docs/design`.
- The project remains TypeScript and macOS-first for this proposed UI.
- The UI must not introduce fallback configuration behavior.
- The renderer should be represented as local packaged content only; no remote assets are needed for the mockup.

## Acceptance Criteria

- A review/plan document exists under `docs/design` with the required `plan-xxx-<description>.md` naming pattern.
- A revised standalone HTML visual exists under `docs/design`.
- A research note exists under `docs/reference` and includes source URLs, access date, key findings, and derived design decisions.
- `docs/design/project-design.md` references the revised visual direction.
- `docs/design/project-functions.md` references the revised visual direction in FR-32.

## Assumptions

- The existing Plan 008 technical architecture is still valid and should not be replaced.
- The user is asking for a design review plus an alternative direction, not production UI implementation.
- The first UI remains a desktop macOS tool for repeated operational use, so the design should stay quiet and functional rather than promotional.

## Open Questions

- Should the next pass turn the revised HTML mockup into production Electron renderer assets?
- Should settings open as a separate native-feeling sheet, or remain as an in-window inspector?
- Should the transcript view prioritize conversation chronology, operator sections, or current live partial text in the default layout?

## Original Request

> Can you review the proposed UI design to try something more modern and closer to the recent macOS aesthetic?


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
