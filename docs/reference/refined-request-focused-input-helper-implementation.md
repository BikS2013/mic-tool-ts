# Refined Request: Focused Input Helper Implementation

## Category

Development

## Objective

Implement the native macOS focused-input helper architecture described in `docs/design/plan-014-focused-input-helper.md` and `docs/design/focused-input-helper-design.md`, replacing the current `pbcopy` plus System Events focused-input path with a bundled Swift helper invoked by `mic-tool-ts`.

## Scope

In scope:

- Add a production Swift helper binary source under the project tree.
- Compile and bundle the helper into `dist/native/macos/mic-tool-ts-input-helper` during the package build.
- Add a TypeScript adapter that resolves the bundled helper, sends transcript text over stdin, parses the helper JSON result, and maps failures into the existing focused-input warning flow.
- Wire the existing `VoiceAgentProtocolController` input operator to the helper adapter while preserving the `inputWriter` test injection surface.
- Add focused automated tests for helper result parsing, process handling, and protocol warning behavior.
- Add a manual smoke script under `test_scripts/` for active focused-control compatibility checks.
- Update README, tool documentation, configuration/design documentation, project functions, and pending-items documentation to describe the implemented helper behavior.

Out of scope:

- Adding new npm runtime dependencies.
- Adding a privileged daemon, LaunchAgent, or global system install.
- Adding user-facing configuration for helper method selection.
- Performing live mutating manual compatibility tests against active applications in this automated implementation pass.
- Changing the public installed invocation away from `mic-tool-ts`.

## Requirements

- The helper must expose `diagnose` and `send --method <auto|ax-value|unicode-events|paste-keycode>`.
- The helper must read delivery text from stdin only and must never receive transcript text in argv.
- The helper must emit exactly one JSON object on stdout for successful command parsing/execution paths and keep human diagnostics on stderr.
- `send --method auto` must attempt direct Accessibility insertion first, Unicode keyboard-event typing second, and clipboard-preserving key-code paste as fallback.
- Helper failures must be fail-open at the protocol level: no focused-input delivery failure may terminate the transcription session.
- `input.sent` must be emitted only when the helper reports successful delivery.
- Missing helper binary, malformed helper output, non-macOS execution, missing Accessibility permission, and unsupported focused controls must produce explicit errors/warnings rather than hidden fallback behavior.
- Transcript text must not be persisted by the helper or echoed in helper stdout/stderr.
- The build must produce an executable helper under `dist/native/macos/` on macOS.

## Constraints

- Existing user/project rules remain in force: no hidden configuration fallback, no unnecessary transcript persistence, and `mic-tool-ts` remains the supported user-facing invocation.
- The implementation must preserve current tests that inject `inputWriter` into `VoiceAgentProtocolController`.
- Swift is acceptable for the helper because the required macOS APIs are native frameworks.
- Direct Accessibility insertion is best-effort and must not be represented as universal.
- The repository already has unrelated modified/untracked files; implementation must not revert unrelated user work.

## Acceptance Criteria

- `pnpm typecheck` passes.
- Focused helper/protocol tests pass.
- `pnpm build` compiles TypeScript and creates `dist/native/macos/mic-tool-ts-input-helper` with executable mode.
- `pnpm test` passes, unless a pre-existing unrelated test failure is identified and documented.
- The helper can be compiled by the build script without adding a new package manager.
- README, `docs/tools/mic-tool-ts.md`, `docs/design/configuration-guide.md`, `docs/design/project-design.md`, and `docs/design/project-functions.md` describe the implemented helper behavior.
- `Issues - Pending Items.md` records the implementation issue/solution and any unresolved manual compatibility work.

## Assumptions

- The implementation target is macOS, matching the rest of the microphone/focused-input behavior.
- A plain `swiftc` build is sufficient for the first helper release.
- Manual compatibility results will be recorded separately after the user runs the smoke matrix in real target apps.
- The existing `input` operator protocol event schema does not need to expose helper method metadata in this implementation.

## Open Questions

- Which manual application matrix entries should block release after the helper is built?
- Whether future packaging/signing changes should stabilize the helper's Accessibility permission identity.

## Original Request

> I want you to study and implement the plans described into the 
>
> • Created the implementation planning/design docs:
>
>   - docs/design/plan-014-focused-input-helper.md:1
>   - docs/design/focused-input-helper-design.md:1
>   - docs/reference/refined-request-focused-input-helper-plan-design.md:1
>
>   I also updated the canonical docs so the plan is discoverable:
>
>   - docs/design/project-functions.md:192 now registers the planned native helper requirements.
>   - docs/design/project-design.md:1525 now has a “Native Focused Input Helper” section.
>
>   The design covers the components, deployment model, stdin/stdout JSON communication, permission behavior, privacy
>   constraints, fallback ordering, packaging, and test strategy. I did not modify production source code or run the
>   test suite because this was a documentation/design task.
