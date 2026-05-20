# Plan 015: UI LLM Configuration

Refined request: `docs/reference/refined-request-ui-llm-configuration.md`  
Google follow-up request: `docs/reference/refined-request-google-llm-provider-ui.md`  
Codebase scans: `docs/reference/codebase-scan-ui-llm-configuration.md`, `docs/reference/codebase-scan-google-llm-provider-ui.md`

## Objective

Expose the existing LLM provider and model/deployment configuration in the Electron UI so refinement and translation use the user-selected LLM settings for UI-started sessions.

## Implementation

1. Extend `RendererSettings` with `llmProvider` and `llmModel`.
2. Map `SafeConfigSummary.llmProvider` and `SafeConfigSummary.llmModel` into initial UI settings.
3. Validate LLM provider/model edits in the shared UI settings normalization path.
4. Persist `llmProvider` and `llmModel` as non-secret UI settings while preserving compatibility with older UI state files.
5. Add Protocol view controls for LLM provider and model/deployment.
6. Pass `--llm-provider` and `--llm-model` from UI settings when starting a session.
7. Apply persisted non-secret UI settings as CLI-equivalent args during UI-load validation, so a persisted `google` provider validates against `GOOGLE_API_KEY` instead of the default Azure OpenAI settings.
8. Implement the Google provider path selected from the UI using `GOOGLE_API_KEY` and Gemini `generateContent`.
9. Update tests and project documentation.

## Files To Modify

- `src/ui/shared.ts`
- `src/ui/settingsStore.ts`
- `src/ui/renderer/index.html`
- `src/ui/renderer/app.ts`
- `src/ui/runtimeSettings.ts`
- `src/llm/google.ts`
- `src/llm/factory.ts`
- `src/config.ts`
- `tests/ui-runtime-settings.test.ts`
- `tests/ui-settings-store.test.ts`
- `tests/llm-google.test.ts`
- `tests/llm-factory.test.ts`
- `tests/config.test.ts`
- `docs/design/project-functions.md`
- `docs/design/project-design.md`
- `Issues - Pending Items.md`

## Acceptance Checks

- Focused UI settings tests pass.
- `pnpm typecheck` passes.
- `pnpm test` passes.
- `pnpm build` passes.
- Packaged Electron UI bridge verification passes.
