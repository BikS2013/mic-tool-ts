/**
 * Tests for the LLM refiner factory.
 */

import { describe, it, expect } from "vitest";
import { createRefiner } from "../src/llm/factory.js";
import { LLMConfigurationError } from "../src/errors.js";
import { AzureOpenAIRefiner } from "../src/llm/azureOpenAI.js";
import { GoogleRefiner } from "../src/llm/google.js";
import type { LLMConfig, LLMProvider } from "../src/llm/types.js";

function azureCfg(): LLMConfig {
  return {
    enabled: true,
    provider: "azure-openai",
    model: "gpt-5.4",
    systemPrompt: "x",
    requestTimeoutMs: 1000,
    verbose: false,
    providerConfig: {
      provider: "azure-openai",
      endpoint: "https://example.openai.azure.com",
      apiKey: "k",
      deployment: "gpt-5.4",
      apiVersion: "2024-10-21",
    },
  };
}

function stubCfg(provider: Exclude<LLMProvider, "azure-openai">): LLMConfig {
  return {
    enabled: true,
    provider,
    model: "x",
    systemPrompt: "x",
    requestTimeoutMs: 1000,
    verbose: false,
    providerConfig: { provider },
  };
}

function googleCfg(): LLMConfig {
  return {
    enabled: true,
    provider: "google",
    model: "gemini-3.5-flash",
    systemPrompt: "x",
    requestTimeoutMs: 1000,
    verbose: false,
    providerConfig: {
      provider: "google",
      apiKey: "google-key",
    },
  };
}

describe("createRefiner", () => {
  it("returns null when disabled", () => {
    const cfg = { ...azureCfg(), enabled: false };
    expect(createRefiner(cfg)).toBeNull();
  });

  it("returns an AzureOpenAIRefiner for provider=azure-openai", () => {
    const r = createRefiner(azureCfg());
    expect(r).toBeInstanceOf(AzureOpenAIRefiner);
  });

  it("returns a GoogleRefiner for provider=google", () => {
    const r = createRefiner(googleCfg());
    expect(r).toBeInstanceOf(GoogleRefiner);
  });

  for (const provider of [
    "openai",
    "anthropic",
    "azure-ai-inference",
    "ollama",
    "litellm",
    "openai-compat",
  ] as const) {
    it(`throws LLMConfigurationError with a useful hint for provider=${provider}`, () => {
      expect(() => createRefiner(stubCfg(provider))).toThrow(
        LLMConfigurationError,
      );
      try {
        createRefiner(stubCfg(provider));
      } catch (err) {
        expect((err as Error).message).toContain(provider);
        expect((err as Error).message).toContain("not implemented in v1");
      }
    });
  }
});
