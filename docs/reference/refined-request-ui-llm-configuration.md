# Refined Request: UI LLM Configuration

## Category
Development / UI configuration.

## Objective
Make the LLM provider and model/deployment used for refinement and translation configurable through the Electron UI.

## Scope
In scope:
- Add UI controls for the existing LLM provider and LLM model/deployment settings.
- Load the displayed LLM provider/model from the same resolved configuration used by CLI mode.
- Persist non-secret LLM provider/model UI edits in `~/.tool-agents/mic-tool-ts/ui-state.json`.
- Apply UI-selected LLM provider/model values to the next UI-started transcription session as explicit CLI-equivalent settings.
- Keep the existing LLM enable/disable control.
- Update focused tests and project documentation.

Out of scope:
- Implementing the seven currently stubbed LLM providers.
- Adding API-key or endpoint editing fields for LLM provider credentials.
- Changing the refinement/translation prompts or operator behavior.
- Adding new runtime dependencies.

## Requirements
- The Protocol view must expose an editable LLM provider selector for all existing supported provider names: `azure-openai`, `openai`, `anthropic`, `google`, `azure-ai-inference`, `ollama`, `litellm`, and `openai-compat`.
- The Protocol view must expose an editable LLM model/deployment text field.
- The renderer settings model must include `llmProvider` and `llmModel`.
- UI settings load must populate `llmProvider` and `llmModel` from `SafeConfigSummary`.
- UI settings update must validate LLM provider/model values and reject invalid settings instead of silently substituting fallback values.
- UI session start must pass the selected LLM provider/model to `resolveConfig()` through `--llm-provider` and `--llm-model`.
- Persisted UI settings must include the non-secret LLM provider/model values and must not persist API keys, endpoints, transcripts, protocol events, or processed outputs.

## Constraints
- Preserve the existing Electron context-isolation and preload IPC model.
- Preserve the configuration rule that missing required provider credentials raise typed errors; the UI must not invent credential defaults.
- The currently unimplemented LLM providers may remain selectable because the CLI already accepts them, but starting a session with an enabled unimplemented provider may raise the existing `LLMConfigurationError`.
- Keep changes scoped to existing UI/configuration surfaces and tests.

## Acceptance Criteria
- LLM provider and model controls appear in the Protocol view and stay synchronized with renderer state.
- Changing the controls persists `llmProvider` and `llmModel` in UI settings.
- `settingsToSessionArgs()` emits `--llm-provider <value>` and `--llm-model <value>`.
- Loading settings from resolved config surfaces the configured LLM provider/model.
- Persisted UI settings round-trip `llmProvider` and `llmModel`.
- Focused UI settings tests, `pnpm typecheck`, `pnpm test`, `pnpm build`, and the Electron UI bridge verification pass.

## Assumptions
- "The LLM used for refinement and translation" means the existing shared LLM provider/model used by both turn refinement and protocol refine/translate operators.
- API-key and endpoint management remains in `.env`, `~/.tool-agents/mic-tool-ts/.env`, shell env, or CLI-equivalent configuration rather than UI text fields.
- The UI should expose all provider names already accepted by the configuration layer, even if only `azure-openai` is implemented today.

## Open Questions
None.

## Original Request
> I want you to make the llm used for refinement and translation configurable through the UI


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
