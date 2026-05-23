---
language: TypeScript
framework: Electron
package_manager: pnpm
build_command: pnpm build
test_command: pnpm test
lint_command: null
entry_points:
  - src/index.ts
  - src/ui/launcher.ts
  - src/ui/electronMain.ts
last_scanned_commit: 9dac83902a61e0f8c9ca42db23c0359400c8a681
request_file: docs/reference/refined-request-google-llm-provider-ui.md
scan_scope: request-driven Google LLM provider implementation for UI-selected provider
generated_at: 2026-05-20
---

# Codebase Scan: Google LLM Provider From UI

## Module Map

- `src/config.ts` — resolves `--llm-provider`, `--llm-model`, and provider-specific LLM credentials.
- `src/llm/types.ts` — defines provider config discriminated unions.
- `src/llm/factory.ts` — dispatches from `LLMConfig` to concrete refiner implementations or stub errors.
- `src/llm/azureOpenAI.ts` — existing no-SDK REST refiner pattern for timeout/dispose/error mapping.
- `src/ui/renderer/app.ts` — owns browser-side UI control behavior and provider-change defaults.
- `tests/config.test.ts` — config resolution tests.
- `tests/llm-factory.test.ts` — factory dispatch and stub-provider tests.
- `tests/llm-google.test.ts` — new focused Google refiner tests.

## Integration Points

In scope:
- Add `GoogleProviderConfig` and `GoogleRefiner`.
- Add `GOOGLE_API_KEY` resolution in `resolveProviderConfig()`.
- Update factory dispatch to construct `GoogleRefiner`.
- Update renderer provider-change handling so choosing `google` sets a Gemini model.
- Update docs and issue tracking.

Out of scope:
- STT provider code.
- Protocol state machine behavior.
- Electron main/preload IPC shape beyond existing UI settings.
- Remaining unimplemented LLM provider adapters.

## Duplication Check

No Google provider implementation exists. The closest reusable pattern is `AzureOpenAIRefiner`, which already implements native `fetch`, request timeout, disposal, HTTP error mapping, JSON parsing, and non-SDK provider integration.

## Conventions Observed

- Provider implementations avoid SDK dependencies when the REST API is compact.
- Missing required LLM credentials are startup-fatal `LLMConfigurationError` values.
- Runtime LLM failures throw `LLMRefinementError` and remain fail-open at the protocol/orchestrator layer.
- The UI stores only non-secret LLM provider/model choices.


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
