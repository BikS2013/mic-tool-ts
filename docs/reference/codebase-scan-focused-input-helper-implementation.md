---
language: TypeScript, Swift
framework: Node.js CLI, macOS native helper
package_manager: pnpm
build_command: pnpm build
test_command: pnpm test
lint_command: null
entry_points:
  - src/index.ts
  - src/main.ts
  - src/core/sessionRunner.ts
last_scanned_commit: bf9c9904a47a6f5ab296a31d843d18491448d3fa
request_file: docs/reference/refined-request-focused-input-helper-implementation.md
scan_scope: request-driven focused-input helper implementation
generated_at: 2026-05-20
---

# Codebase Scan: Focused Input Helper Implementation

## Summary

The repository is an existing TypeScript Node CLI with a macOS-specific focused-input path currently implemented directly inside `src/protocol/controller.ts`. Plan 014 should be implemented as an extension of that existing input operator, not as a parallel command or separate user-facing tool.

The requested feature is partially implemented today: `command input` state, protocol events, warning behavior, and tests already exist. The missing parts are the native helper binary, helper build packaging, TypeScript process adapter, and documentation updates from paste-only behavior to helper-based delivery.

## Module Map

- `src/index.ts` — package binary entry point for the installed `mic-tool-ts` command.
- `src/main.ts` — CLI command parsing/dispatch entry point.
- `src/core/sessionRunner.ts` — session orchestration, renderer selection, protocol controller construction, transcriber/mic lifecycle, UI event sink integration.
- `src/protocol/controller.ts` — voice-agent operator pipeline owner. In-scope: currently owns `copyToClipboard`, `sendToFocusedInput`, `runCommand`, `input.sent`, and focused-input warning behavior.
- `src/protocol/types.ts` — protocol event schema. Out-of-scope unless method metadata is added to `input.sent`.
- `tests/protocol.test.ts` — focused controller tests already cover successful input delivery, final refined/translated delivery, and warning/fail-open behavior.
- `test_scripts/focused-text-delivery-poc.swift` — existing Swift proof of concept for diagnose, AX insertion, Unicode typing, and key-code paste.
- `package.json` — build/test scripts. In-scope for adding native helper build step.
- `README.md`, `docs/tools/mic-tool-ts.md`, `docs/design/configuration-guide.md`, `docs/design/project-functions.md`, `docs/design/project-design.md` — user-facing and canonical docs with paste-only or planned-helper language.

## Conventions

- TypeScript source uses ESM imports with explicit `.js` suffixes for local imports.
- Tests use Vitest and direct dependency injection rather than live microphone/focused-control interactions.
- Runtime configuration must fail explicitly when required values are missing; hidden configuration fallbacks are prohibited.
- The public installed invocation is `mic-tool-ts`; docs must not present helper binaries or package-manager commands as primary user invocation.
- Manual testing scripts belong under `test_scripts/`.
- Project reference artifacts belong under `docs/reference/`.

## Integration Points

### In Scope

- `src/protocol/controller.ts` — replace the default focused-input writer with the helper adapter while preserving `inputWriter?: (text: string) => Promise<void>`.
- New `src/platform/macos/focusedInputHelper.ts` — helper path resolution, child process execution, stdin/stdout JSON parsing, error mapping, and exported delivery API.
- New `native/macos/input-helper/main.swift` — production Swift helper source promoted from the POC and hardened to the JSON contract.
- New `scripts/build-native-helper.mjs` — Node build script that invokes `swiftc`, creates `dist/native/macos/`, and verifies executable output.
- `package.json` — update `build` to run the native helper build after `tsc` and UI asset copy.
- `tests/protocol.test.ts` — adjust expected remediation behavior if helper-specific warnings replace System Events-only wording.
- New `tests/focused-input-helper.test.ts` — unit tests for adapter parsing, child process behavior, path resolution, and failure mapping.
- New `test_scripts/focused-input-helper-smoke.sh` — manual compatibility helper for diagnose/send smoke checks.
- Documentation listed above — update planned/paste-only language to implemented helper language.

### Out of Scope

- `src/config.ts` and config parser modules — no new user-facing configuration is required for the first implementation.
- `src/ui/*` rendering and global hotkey modules — UI may surface existing protocol warnings through the shared session event path without UI-specific changes.
- Transcription provider clients under `src/soniox/` and `src/elevenlabs/`.
- LLM refiner/translater modules under `src/llm/`.

### New Integration Points

- `dist/native/macos/mic-tool-ts-input-helper` — build output consumed by the TypeScript adapter at runtime.
- Helper stdout JSON schema:
  - success: `{ "ok": true, "method": "ax-value" | "unicode-events" | "paste-keycode", ... }`
  - failure: `{ "ok": false, "code": string, "message": string, ... }`

## Duplication Check

The feature is partially implemented but not duplicated:

- Current focused-input behavior exists only as paste automation in `src/protocol/controller.ts`.
- The Swift helper exists only as a proof-of-concept script under `test_scripts/` and is not built or invoked by production TypeScript.
- The implementation should extend the existing `input` operator and protocol warning path, not add a second operator or public helper command.

## Recommended Implementation Notes

- Keep `VoiceAgentProtocolControllerOptions.inputWriter` unchanged so existing protocol tests stay deterministic.
- Export helper adapter internals only where needed for unit tests; keep the public API narrow.
- Avoid a fallback from missing helper binary to the old `osascript` path because project configuration rules prohibit hidden fallback behavior. Missing helper should produce an explicit warning.
- Build native helper with plain `swiftc` to avoid introducing Swift Package Manager files in the first implementation.
- Do not echo transcript text in helper stderr/stdout or TypeScript error messages.
