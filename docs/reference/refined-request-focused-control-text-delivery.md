# Refined Request: Focused Control Text Delivery

## Category

Research / Architecture Investigation

## Objective

Investigate alternatives to the current clipboard-plus-Command-V focused-input delivery path and determine whether `mic-tool-ts` can reliably send transcribed text directly to the focused control in the active macOS application and window.

## Scope

In scope:

- Identify macOS-supported or practical approaches for delivering arbitrary text to the currently focused text control without relying on normal paste.
- Compare approaches that can be integrated into `mic-tool-ts`, including a separate helper/system tool if needed.
- Consider implementations in TypeScript, Swift, Objective-C, C, AppleScript/JXA, or another suitable technology.
- Evaluate whether each approach can target the active application/window/control, preserve clipboard contents, avoid leaking the push-to-talk hotkey into the target app, and handle non-US keyboard layouts.
- Identify required macOS permissions and likely user setup steps.
- Recommend a primary implementation direction and fallback strategy.
- Produce an investigation document under `docs/reference/`.

Out of scope for this request:

- Implementing the chosen tool or modifying production code.
- Adding new runtime dependencies.
- Changing the global hotkey itself.
- Solving STT accuracy, LLM refinement, or protocol state-machine behavior.

## Requirements

- The investigation must account for the current implementation in `src/protocol/controller.ts`, where focused input copies text with `pbcopy` and sends `Command+V` through System Events.
- The investigation must include at least these candidate families:
  - Keyboard event synthesis using physical key codes.
  - Clipboard-preserving paste variants.
  - Accessibility API insertion into the focused UI element.
  - Native macOS helper tool or app/service.
  - App-specific automation such as AppleScript/JXA where relevant.
- For each candidate, document feasibility, permissions, reliability risks, implementation complexity, packaging implications, and testability.
- The recommendation must prefer a solution that can work with common editors, browser text areas, terminals, and native macOS text fields.
- The recommendation must explicitly state when direct insertion is impossible or unreliable and when paste remains the only practical universal path.

## Constraints

- Existing project tool invocation remains `mic-tool-ts`; do not recommend user-facing development commands as the installed invocation.
- Any project-owned tool code should normally be TypeScript, but this investigation may recommend another technology if macOS APIs make that materially better.
- The project rule against hidden configuration fallbacks still applies: missing required configuration or permission prerequisites must surface explicit errors or warnings.
- No implementation should persist transcripts or processed output unnecessarily.
- Any future helper must fit macOS permission models for Accessibility/Input Monitoring and be explainable in project documentation.

## Acceptance Criteria

- A research document exists at `docs/reference/investigation-focused-control-text-delivery.md`.
- The document compares viable macOS approaches against explicit criteria.
- The document recommends a primary approach and at least one fallback.
- The document identifies whether a separate native helper/system tool is justified.
- The document lists proof-of-concept checks needed before implementation.
- The final response summarizes the recommendation, confidence, and open risks.

## Assumptions

- The target platform for this investigation is macOS, because the current focused-input and global-hotkey implementation is macOS-specific.
- The active target control is already focused by the user when delivery happens.
- The expected text may include Greek, English, punctuation, and multiline content.
- The user is willing to grant macOS Accessibility/Input Monitoring permissions if the chosen approach requires them.

## Open Questions

- Should the future implementation preserve and restore the user's clipboard even if that increases latency and complexity?
- Should a helper be embedded inside the Electron app, shipped as a separate binary, or installed as an external user-level tool?
- Which target applications are highest priority for manual proof-of-concept testing?

## Original Request

> Can you investigate if there is any other way that the copy text could deliver to the focused control instead of pasting? 
> Even if that means we have to create a separate tool, even if this tool must be in other technology instead of TypeScript. 
> Can you examine if it’s working to create a system tool to send text to the focused control on the active application and active window?


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
