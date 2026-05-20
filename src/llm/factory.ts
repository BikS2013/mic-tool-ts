/**
 * Refiner factory — picks the concrete LLM client based on the resolved
 * `LLMConfig.provider`. Returns `null` when LLM refinement is disabled.
 *
 * v1 status: `azure-openai` and `google` are implemented. The other six
 * convention-mandated providers ("openai", "anthropic",
 * "azure-ai-inference", "ollama", "litellm", "openai-compat") are accepted
 * by configuration but throw `LLMConfigurationError` at construction time
 * with a message naming the env vars to set when implementation lands.
 */

import { LLMConfigurationError } from "../errors.js";
import { AzureOpenAIRefiner } from "./azureOpenAI.js";
import { GoogleRefiner } from "./google.js";
import type { LLMConfig, LLMRefiner } from "./types.js";

const NOT_IMPLEMENTED_HINT: Record<
  Exclude<LLMConfig["provider"], "azure-openai" | "google">,
  string
> = {
  "openai":
    "Provider 'openai' is not implemented in v1. To enable, set OPENAI_API_KEY and add the OpenAI refiner. Use --llm-provider azure-openai for now.",
  "anthropic":
    "Provider 'anthropic' is not implemented in v1. To enable, set ANTHROPIC_API_KEY and add the Anthropic refiner.",
  "azure-ai-inference":
    "Provider 'azure-ai-inference' is not implemented in v1. To enable, set AZURE_AI_INFERENCE_ENDPOINT and AZURE_AI_INFERENCE_API_KEY and add the refiner.",
  "ollama":
    "Provider 'ollama' is not implemented in v1. To enable, set OLLAMA_HOST and add the Ollama refiner.",
  "litellm":
    "Provider 'litellm' is not implemented in v1. To enable, set LITELLM_BASE_URL and LITELLM_API_KEY and add the refiner.",
  "openai-compat":
    "Provider 'openai-compat' is not implemented in v1. To enable, set OPENAI_COMPAT_BASE_URL and OPENAI_COMPAT_API_KEY and add the refiner.",
};

export function createRefiner(cfg: LLMConfig): LLMRefiner | null {
  if (!cfg.enabled) return null;

  if (cfg.providerConfig.provider === "azure-openai") {
    return new AzureOpenAIRefiner({
      ...cfg,
      providerConfig: cfg.providerConfig,
    });
  }

  if (cfg.providerConfig.provider === "google") {
    return new GoogleRefiner({
      ...cfg,
      providerConfig: cfg.providerConfig,
    });
  }

  throw new LLMConfigurationError(NOT_IMPLEMENTED_HINT[cfg.providerConfig.provider]);
}
