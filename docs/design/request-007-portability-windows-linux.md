# Refined Request: Windows and Linux Portability Investigation

## Category

Research / Architecture Assessment

## Objective

Determine whether the current `mic-tool-ts` implementation can be ported from macOS to Windows and Linux, identify which parts are already portable, which parts are macOS-specific, and recommend a practical porting strategy.

## Scope

In scope:

- Inspect the current TypeScript implementation, design documents, tool reference, tests, and dependency usage.
- Identify platform-specific assumptions in microphone capture, process management, path/config handling, terminal rendering, signal handling, WebSocket/STT clients, and LLM refinement.
- Compare Windows and Linux microphone-capture options that can produce the tool's required PCM stream.
- Produce an investigation report under `docs/reference` with findings, risks, options, and recommendations.

Out of scope:

- Implementing Windows or Linux microphone backends.
- Adding or replacing runtime dependencies.
- Running live microphone tests on Windows or Linux from this macOS workspace.
- Changing the public CLI contract unless the report recommends future changes.

## Requirements

- The investigation must distinguish current portability from required engineering work.
- The report must include a component-by-component portability assessment.
- The report must include specific blockers for Windows and Linux.
- The report must recommend the best next implementation path and explain alternatives.
- Any external research used must be recorded with source URLs, access date, key findings, and derived implementation constraints.

## Constraints

- Do not perform version-control operations.
- Do not implement the port in this pass.
- Preserve the current direct command invocation contract: `mic-tool-ts`.
- Respect the project's no-hidden-fallbacks configuration rule.
- Use project documentation locations required by `AGENTS.md`.

## Acceptance Criteria

- A report exists at `docs/reference/investigation-007-portability-windows-linux.md`.
- The report answers whether the current implementation is portable as-is.
- The report identifies the smallest viable code changes needed for Windows and Linux support.
- The report identifies likely dependencies or external binaries needed per target OS.
- The final response summarizes the verdict, confidence, report path, and remaining open questions.

## Assumptions

- "Portable" means usable as the installed `mic-tool-ts` command on Windows and Linux without requiring users to edit source code.
- The initial target remains Node.js >= 20.12 and TypeScript.
- The existing STT and LLM provider abstractions should be preserved unless the investigation finds a hard blocker.
- Live validation on Windows and Linux will be done in a later implementation/testing phase.

## Open Questions

- Which Windows audio input stack should be preferred by the project: FFmpeg DirectShow, SoX for Windows, a native Node addon, or a future pure-JavaScript/native bridge?
- Which Linux audio stack should be the baseline: ALSA, PulseAudio/PipeWire through FFmpeg, or SoX's default device support?
- Should the project keep external command-line capture tools as prerequisites, or invest in a native cross-platform audio dependency?

## Original Request

> I want you to investigate whether the current implementation is portable to other operating systems. I want you to study it thoroughly and understand whether I can port it to Windows and Linux platforms.


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
