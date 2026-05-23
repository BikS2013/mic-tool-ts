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
request_file: docs/reference/refined-request-ui-llm-configuration.md
scan_scope: request-driven Electron UI LLM provider/model configuration
generated_at: 2026-05-20
---

# Codebase Scan: UI LLM Configuration

## Module Map

- `src/config.ts` — parses and validates `--llm-provider`, `--llm-model`, and `--refine` / `--no-refine`; resolves `MIC_TOOL_TS_LLM_PROVIDER` and `MIC_TOOL_TS_LLM_MODEL`; constructs `ResolvedConfig.llm`.
- `src/llm/types.ts` — defines `LLMProvider`, `LLM_PROVIDERS`, and `LLMConfig`. The provider list already includes the eight standard provider names.
- `src/core/sessionEvents.ts` — exposes `SafeConfigSummary.llmEnabled`, `llmProvider`, and `llmModel` through UI-safe session/config events.
- `src/ui/shared.ts` — defines the main-process renderer settings contract, default settings, normalization, and `settingsToSessionArgs()`.
- `src/ui/runtimeSettings.ts` — loads resolved CLI configuration and persisted UI settings, then creates renderer settings for initial UI display.
- `src/ui/settingsStore.ts` — persists non-secret UI settings to `~/.tool-agents/mic-tool-ts/ui-state.json` and validates state-file shape.
- `src/ui/electronMain.ts` — receives UI setting updates, saves settings, and starts the shared session runner with `settingsToSessionArgs(latestSettings)`.
- `src/ui/renderer/index.html` — contains Protocol view controls and inspector content.
- `src/ui/renderer/app.ts` — mirrors the renderer-side `RendererSettings` shape, parses IPC settings, syncs controls, collects control values, and renders summary rows.
- `tests/ui-runtime-settings.test.ts` — covers UI settings load, persisted UI overlays, and config inspection behavior.
- `tests/ui-settings-store.test.ts` — covers persisted UI settings round-trips and secret exclusion.
- `test_scripts/verify-ui-bridge.cjs` — launches packaged Electron renderer and verifies bridge/layout behavior.

## Integration Points

In scope:
- `src/ui/shared.ts` — add `llmProvider` and `llmModel`; validate provider against `LLM_PROVIDERS`; include both in session args.
- `src/ui/settingsStore.ts` — include non-secret LLM provider/model in persisted settings validation and serialization.
- `src/ui/runtimeSettings.ts` — continue deriving values through `settingsFromConfig()` once `SafeConfigSummary` is mapped.
- `src/ui/renderer/index.html` — add LLM provider/model controls to the Protocol view.
- `src/ui/renderer/app.ts` — add renderer-side fields, parsing, control sync, collection, and summary rows.
- `tests/ui-runtime-settings.test.ts` and `tests/ui-settings-store.test.ts` — assert LLM provider/model load, persistence, and session argument behavior.
- `docs/design/project-functions.md`, `docs/design/project-design.md`, and `Issues - Pending Items.md` — document the UI LLM configuration change.

Out of scope:
- `src/llm/factory.ts` and provider adapters; this change does not implement additional LLM providers.
- STT provider clients under `src/soniox/` and `src/elevenlabs/`.
- Voice protocol state machine semantics for refine/translate.
- Native focused-input helper and global hotkey code.

## Duplication Check

No separate UI-specific LLM configuration mechanism exists. The UI already has an `llmEnabled` setting and the core CLI already supports provider/model flags. This request should extend the existing renderer settings pipeline instead of introducing a new config store or IPC channel.

## Conventions Observed

- Renderer settings use a shared TypeScript contract in `src/ui/shared.ts`, then a matching browser-side shape in `src/ui/renderer/app.ts`.
- UI updates cross the preload bridge as partial `RendererSettings` patches and are validated in Electron main by `mergeRendererSettings()`.
- Persisted UI state stores only non-secret user-editable values and excludes credential status, API keys, transcripts, and protocol payloads.
- Session start builds explicit CLI-equivalent arguments from normalized renderer settings.


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
