# Refined Request: untype UI Capability Screenshots

## Category
Documentation / UI discovery.

## Objective
Attach to the local untype application UI, discover the visible user interface, identify the available UI options and workflows, and collect screenshots that describe the application's capabilities and how it works.

## Scope
In scope:
- Launch or attach to the local untype Electron UI.
- Inspect the UI screens, panes, controls, menus, and visible states available without exposing secrets.
- Capture screenshots that illustrate the major capabilities and workflows.
- Store screenshots and a concise capability index under project documentation/reference material.

Out of scope:
- Source-code changes to the application.
- Runtime transcription with real microphone audio unless it is already safely configured and does not require secret exposure.
- Editing secrets, credentials, or provider account settings.
- Publishing or committing artifacts to version control.

## Requirements
- Use the local untype project at `/Users/giorgosmarinos/aiwork/coding-platform/untype` as the active project.
- Prefer the documented `untype ui` entry point where feasible.
- Do not display or record secret values in screenshots.
- Capture enough screenshots to show the primary UI surface and configurable options.
- Produce a short written inventory that maps screenshots to capabilities.

## Constraints
- The UI may require local macOS permissions and/or configured provider credentials.
- If live transcription cannot be started safely, document the UI capabilities visible before starting a real listening session.
- Screenshots must be stored as project reference material.
- No version control operations should be performed.

## Acceptance Criteria
- A screenshot folder exists under `docs/reference/` with captured untype UI images.
- A capability inventory document exists under `docs/reference/` and lists the UI options discovered.
- The inventory references the screenshot files by path.
- Any limitation encountered, such as missing credentials, blocked permissions, or inability to start live audio, is documented.

## Assumptions
- "Untype application" refers to the Electron UI launched by `untype ui`.
- The user wants documentation artifacts rather than code changes.
- It is acceptable to inspect local source and docs to guide UI discovery, as long as screenshots are captured from the running UI where possible.

## Open Questions
- None blocking. If the user wants real microphone transcription states captured, that may require a follow-up pass with credentials and permissions confirmed.

## Original Request
I want you to attach to the untype application, discover its user interface, the options it has in its user interface, and collect all the screenshots that describe its capabilities and how it works.
