/**
 * Tests for the Azure OpenAI LLM refiner (`src/llm/azureOpenAI.ts`).
 *
 * Mocks `globalThis.fetch` to exercise the HTTP layer without making real
 * network calls. Covers happy path, error mapping for each `LLMRefinementError`
 * kind, and abort-on-dispose.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AzureOpenAIRefiner } from "../src/llm/azureOpenAI.js";
import { LLMRefinementError } from "../src/errors.js";
import type {
  AzureOpenAIProviderConfig,
  LLMConfig,
} from "../src/llm/types.js";

function makeCfg(
  override: Partial<AzureOpenAIProviderConfig> = {},
): LLMConfig & { providerConfig: AzureOpenAIProviderConfig } {
  return {
    enabled: true,
    provider: "azure-openai",
    model: "gpt-5.4",
    systemPrompt: "test prompt",
    requestTimeoutMs: 1000,
    verbose: false,
    providerConfig: {
      provider: "azure-openai",
      endpoint: "https://example.openai.azure.com",
      apiKey: "test-key",
      deployment: "gpt-5.4",
      apiVersion: "2024-10-21",
      ...override,
    },
  };
}

describe("AzureOpenAIRefiner — happy path", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to the correct URL with api-key header and returns the trimmed message content", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "  Hello, world!  " } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const r = new AzureOpenAIRefiner(makeCfg());
    const out = await r.refine("hello wrld");
    expect(out).toBe("Hello, world!");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://example.openai.azure.com/openai/deployments/gpt-5.4/chat/completions?api-version=2024-10-21",
    );
    expect(init.method).toBe("POST");
    expect(init.headers["api-key"]).toBe("test-key");
    expect(init.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body);
    expect(body.messages[0]).toEqual({ role: "system", content: "test prompt" });
    expect(body.messages[1]).toEqual({ role: "user", content: "hello wrld" });
    expect(body.temperature).toBe(0.2);
  });

  it("strips trailing slashes from endpoint when building the URL", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
        { status: 200 },
      ),
    );
    const r = new AzureOpenAIRefiner(
      makeCfg({ endpoint: "https://example.openai.azure.com/" }),
    );
    await r.refine("hi");
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://example.openai.azure.com/openai/deployments/gpt-5.4/chat/completions?api-version=2024-10-21",
    );
  });

  it("URL-encodes deployment and api-version in the path/query", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
        { status: 200 },
      ),
    );
    const r = new AzureOpenAIRefiner(
      makeCfg({ deployment: "weird name", apiVersion: "2025-01-01-preview" }),
    );
    await r.refine("hi");
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/deployments/weird%20name/");
    expect(url).toContain("?api-version=2025-01-01-preview");
  });
});

describe("AzureOpenAIRefiner — error mapping", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps HTTP 401 to LLMRefinementError kind='auth'", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("nope", { status: 401 }),
    );
    const r = new AzureOpenAIRefiner(makeCfg());
    await expect(r.refine("x")).rejects.toMatchObject({
      name: "LLMRefinementError",
      kind: "auth",
    });
  });

  it("maps HTTP 403 to LLMRefinementError kind='auth'", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("forbidden", { status: 403 }),
    );
    const r = new AzureOpenAIRefiner(makeCfg());
    await expect(r.refine("x")).rejects.toMatchObject({ kind: "auth" });
  });

  it("maps HTTP 500 to LLMRefinementError kind='server'", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("oops", { status: 500 }),
    );
    const r = new AzureOpenAIRefiner(makeCfg());
    await expect(r.refine("x")).rejects.toMatchObject({ kind: "server" });
  });

  it("maps HTTP 429 to LLMRefinementError kind='server'", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("rate-limited", { status: 429 }),
    );
    const r = new AzureOpenAIRefiner(makeCfg());
    await expect(r.refine("x")).rejects.toMatchObject({ kind: "server" });
  });

  it("maps a fetch network failure to LLMRefinementError kind='network'", async () => {
    fetchMock.mockRejectedValueOnce(
      Object.assign(new Error("getaddrinfo ENOTFOUND"), { name: "TypeError" }),
    );
    const r = new AzureOpenAIRefiner(makeCfg());
    await expect(r.refine("x")).rejects.toMatchObject({ kind: "network" });
  });

  it("maps an aborted-by-timeout fetch to LLMRefinementError kind='timeout'", async () => {
    fetchMock.mockImplementation(
      () =>
        new Promise((_, reject) => {
          // Reject after the timeout fires.
          setTimeout(() => {
            const err = new Error("LLM request timed out");
            (err as Error).name = "AbortError";
            reject(err);
          }, 5);
        }),
    );
    const r = new AzureOpenAIRefiner(makeCfg({ apiKey: "x" }));
    await expect(r.refine("x")).rejects.toMatchObject({ kind: "timeout" });
  });

  it("maps a malformed JSON body to LLMRefinementError kind='shape'", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("not json", { status: 200 }),
    );
    const r = new AzureOpenAIRefiner(makeCfg());
    await expect(r.refine("x")).rejects.toMatchObject({ kind: "shape" });
  });

  it("maps a missing choices[0].message.content to LLMRefinementError kind='shape'", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: {} }] }), {
        status: 200,
      }),
    );
    const r = new AzureOpenAIRefiner(makeCfg());
    await expect(r.refine("x")).rejects.toMatchObject({ kind: "shape" });
  });

  it("throws kind='network' after dispose()", async () => {
    const r = new AzureOpenAIRefiner(makeCfg());
    r.dispose();
    await expect(r.refine("x")).rejects.toBeInstanceOf(LLMRefinementError);
  });
});

describe("AzureOpenAIRefiner — dispose", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("aborts an in-flight request when dispose() is called", async () => {
    // Hold the fetch open until aborted.
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_, reject) => {
          (init.signal as AbortSignal).addEventListener("abort", () => {
            const err = new Error("aborted");
            (err as Error).name = "AbortError";
            reject(err);
          });
        }),
    );
    const r = new AzureOpenAIRefiner(makeCfg());
    const p = r.refine("x");
    r.dispose();
    await expect(p).rejects.toMatchObject({
      name: "LLMRefinementError",
    });
  });

  it("dispose() is idempotent", () => {
    const r = new AzureOpenAIRefiner(makeCfg());
    expect(() => {
      r.dispose();
      r.dispose();
    }).not.toThrow();
  });
});
