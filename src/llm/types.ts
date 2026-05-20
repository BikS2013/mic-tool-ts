/**
 * LLM refinement — shared types.
 *
 * The `LLMRefiner` abstraction lets the orchestrator wire in a single
 * `refine(text) → Promise<text>` call regardless of the underlying provider.
 * Implementations live alongside this file (`azureOpenAI.ts`, etc.). The
 * factory at `factory.ts` picks one based on the resolved CLI/env config.
 *
 * Eight standard LLM provider names per project convention:
 *   - "azure-openai"        ← fully implemented in v1
 *   - "google"              ← fully implemented in v1
 *   - "openai"              \
 *   - "anthropic"            \
 *   - "azure-ai-inference"    /  with a clear "not implemented in v1" message
 *   - "ollama"               /
 *   - "litellm"             /
 *   - "openai-compat"      /
 */

export type LLMProvider =
  | "azure-openai"
  | "openai"
  | "anthropic"
  | "google"
  | "azure-ai-inference"
  | "ollama"
  | "litellm"
  | "openai-compat";

export const LLM_PROVIDERS: readonly LLMProvider[] = [
  "azure-openai",
  "openai",
  "anthropic",
  "google",
  "azure-ai-inference",
  "ollama",
  "litellm",
  "openai-compat",
] as const;

export interface AzureOpenAIProviderConfig {
  readonly provider: "azure-openai";
  readonly endpoint: string;
  readonly apiKey: string;
  readonly deployment: string;
  readonly apiVersion: string;
}

export interface GoogleProviderConfig {
  readonly provider: "google";
  readonly apiKey: string;
}

/**
 * Placeholder shape for the six not-yet-implemented providers. We collect
 * the env-var values we found (or `null`) so the stubbed refiner can produce
 * a useful "missing X / set Y" error message.
 */
export interface UnimplementedProviderConfig {
  readonly provider: Exclude<LLMProvider, "azure-openai" | "google">;
}

export type ProviderConfig =
  | AzureOpenAIProviderConfig
  | GoogleProviderConfig
  | UnimplementedProviderConfig;

export interface LLMConfig {
  readonly enabled: boolean;
  readonly provider: LLMProvider;
  readonly model: string;
  readonly systemPrompt: string;
  readonly requestTimeoutMs: number;
  readonly providerConfig: ProviderConfig;
  /** When true, the refiner emits diagnostic logs to stderr. */
  readonly verbose: boolean;
}

/**
 * Refines a turn's verbatim transcript. Returns the cleaned text on success
 * or throws an `LLMRefinementError` on failure (auth, network, timeout,
 * server, or unexpected response shape).
 *
 * Implementations must:
 *   - Respect `requestTimeoutMs` via `AbortController`.
 *   - Return the cleaned text without leading/trailing whitespace.
 *   - Honor `dispose()` by aborting any in-flight request.
 */
export interface LLMRefiner {
  refine(text: string): Promise<string>;
  dispose(): void;
}
