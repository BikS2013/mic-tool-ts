# plan-003 — LLM refinement of each turn

## Goal
After each turn closes (guard phrase fires), send the turn's transcribed text to an LLM and render the refined/corrected version one blank line under the boundary, followed by another blank line.

## User-confirmed decisions
- Feature is **on by default** in v1.
- Initial provider: **Azure OpenAI**.
- Initial model / deployment name: **gpt-5.4**.
- LLM provider/model **must** follow the project's "introduction of LLM providers" conventions (vendor-canonical env var names, four-tier env-var resolution chain, eight standard providers supported out of the box).

## Rendering contract
For each turn that closes with the guard phrase:

```
<finals containing τέλος εντολής>\n
                                   ← blank line from turnBoundary() (existing)
<refined text>\n
                                   ← additional blank line under the refinement
```

If the refinement fails or is disabled, only the blank line from the turn boundary remains (no degradation of existing behavior).

## Design

### 1. Four-tier env-var resolution
Priority (highest first), per project convention:
1. CLI flag
2. local `.env` (CWD)
3. `~/.tool-agents/mic-tool/.env`
4. shell env

A new helper `src/config/envChain.ts` reads keys with this precedence. Applies to:
- `SONIOX_API_KEY` (existing — extended to four tiers; previously three)
- `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION`
- (future) `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `AZURE_AI_INFERENCE_*`, `OLLAMA_HOST`, `LITELLM_*`

### 2. Config additions
New `ResolvedConfig` fields:
- `llm: LLMConfig`
  - `enabled: boolean` — default `true`
  - `provider: LLMProvider` — default `"azure-openai"`
  - `model: string` — default `"gpt-5.4"`
  - `systemPrompt: string` — default cleanup prompt (see below)
  - `requestTimeoutMs: number` — default `15000`
  - `providerSpecific: { … }` — provider-specific resolved fields

New CLI flags:
- `--refine` / `--no-refine` — toggle the feature (default on)
- `--llm-provider <name>` — one of the 8 supported names
- `--llm-model <name>` — provider-specific model / deployment name

The eight supported provider names (per project convention):
`azure-openai`, `openai`, `anthropic`, `google`, `azure-ai-inference`, `ollama`, `litellm`, `openai-compat`.

**v1 implementation status**:
- `azure-openai` — fully implemented
- All others — accepted by validation but throw `LLMProviderNotImplementedError` at refiner construction with the required env vars in the message so the user knows what to set

### 3. LLM module (`src/llm/`)
- `types.ts` — `LLMRefiner`, `LLMConfig`, `LLMProvider`, `ProviderConfig` union
- `azureOpenAI.ts` — `AzureOpenAIRefiner implements LLMRefiner`:
  - POST `{endpoint}/openai/deployments/{deployment}/chat/completions?api-version={apiVersion}`
  - Headers: `api-key: {key}`, `Content-Type: application/json`
  - Body: chat-completion with system + user messages, `temperature: 0.2`
  - Uses `fetch` (Node 20+ native) with `AbortController` for timeout and shutdown
  - Maps HTTP 401/403 → `LLMAuthError`, 429/5xx → `LLMRequestError`, network/timeout → `LLMNetworkError`
- `factory.ts` — `createRefiner(llmConfig): LLMRefiner` (or `null` if disabled)

### 4. Errors (`src/errors.ts`)
New non-fatal classes (do NOT cause process exit; logged and skipped):
- `LLMConfigurationError` — startup-time validation failure, exit code 2 (fatal). Thrown from config when `--refine` is on but required Azure env vars are missing.
- `LLMRefinementError` (with sub-codes via the cause: auth, network, timeout, server) — runtime failure during a refinement attempt; logged under verbose, no exit.

### 5. Turn detector changes
`GuardPhraseTurnDetector` accepts an optional `LLMRefiner`:
- Captures the current `buffer` BEFORE the reset (this is the turn text).
- Strips the guard phrase from the captured text using the same normalization the matcher uses (so `τέλος εντολής!` becomes ``).
- Fires `refiner.refine(strippedText)` asynchronously. Does NOT await.
- On resolution: `renderer.refined(text)`. On rejection: log under verbose; skip.
- If the renderer is disposed before the refinement resolves, drop the result silently.

### 6. Renderer changes
New method `refined(text: string)`:
- `overwrite` mode: if `prevLen > 0` (an in-progress partial of the next turn is showing), write `\n` first to commit it, reset `prevLen = 0`. Then write `text + "\n\n"`.
- `append` / `final-only` modes: write `text + "\n\n"`.
- No-op after `dispose()`.

### 7. Config folder
- `~/.tool-agents/mic-tool/` at `0700` (created on first run if missing).
- `~/.tool-agents/mic-tool/.env` at `0600` — user-editable, holds canonical env vars.
- Local `.env.example` updated with the new LLM env-var names (commented out, with explanatory comments).

## Default system prompt
```
You are a transcript-cleanup assistant. The input is a verbatim transcript of someone speaking and may contain disfluencies, filler words, false starts, and grammatical noise. Rewrite the text so it is grammatically correct and easy to read, preserving the speaker's meaning AND the original language. Respond with ONLY the cleaned text — no preamble, no quotes, no markdown, no explanation.
```

## Test impact
- New `tests/llm-azure-openai.test.ts` — mock `fetch`, cover happy path, auth failure, timeout, malformed response, abort on dispose.
- New `tests/llm-factory.test.ts` — dispatches correctly; disabled returns null; unimplemented providers throw with a useful message.
- `tests/turn-detector.test.ts` — extend to cover refiner wiring: captures buffer, strips guard phrase, calls refiner, renders refined output; refiner errors are swallowed; dispose drops in-flight results.
- `tests/renderer.test.ts` — `refined()` in all three modes + post-dispose no-op + in-progress partial handling in overwrite.
- `tests/config.test.ts` — `--refine`/`--no-refine` default and toggle, missing Azure env vars throw `LLMConfigurationError`, `--llm-provider` / `--llm-model` flags.
- `tests/main.test.ts` — orchestrator wires the refiner into the detector when enabled; null wiring when disabled.

## Non-goals
- Streaming the LLM response token-by-token. (Buffered single render.)
- Conversation history across turns. (Each turn is independent.)
- A "regenerate" command. (One-shot per turn; if it fails, it fails.)
- Implementing every provider end-to-end. (Azure OpenAI fully; others scaffolded + stubbed for v2.)
