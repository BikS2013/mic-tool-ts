import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleRefiner } from "../src/llm/google.js";
import type { LLMConfig } from "../src/llm/types.js";

function cfg(overrides: Partial<LLMConfig> = {}): LLMConfig & {
  providerConfig: { provider: "google"; apiKey: string };
} {
  return {
    enabled: true,
    provider: "google",
    model: "gemini-3.5-flash",
    systemPrompt: "Clean this transcript.",
    requestTimeoutMs: 1000,
    verbose: false,
    providerConfig: {
      provider: "google",
      apiKey: "google-key",
    },
    ...overrides,
  } as LLMConfig & { providerConfig: { provider: "google"; apiKey: string } };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GoogleRefiner", () => {
  it("calls Gemini generateContent and returns candidate text", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                { text: " Polished " },
                { text: "text. " },
              ],
            },
          },
        ],
      }), { status: 200 }),
    );
    const refiner = new GoogleRefiner(cfg());

    await expect(refiner.refine("raw text")).resolves.toBe("Polished text.");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",
    );
    expect(String(url)).toContain("key=google-key");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body.systemInstruction.parts[0].text).toBe("Clean this transcript.");
    expect(body.contents[0].parts[0].text).toBe("raw text");
  });

  it("maps auth HTTP errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("no", { status: 403 }),
    );
    const refiner = new GoogleRefiner(cfg());

    await expect(refiner.refine("raw")).rejects.toMatchObject({
      name: "LLMRefinementError",
      kind: "auth",
    });
  });

  it("maps missing text response shape", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [] } }] }), {
        status: 200,
      }),
    );
    const refiner = new GoogleRefiner(cfg());

    await expect(refiner.refine("raw")).rejects.toMatchObject({
      name: "LLMRefinementError",
      kind: "shape",
    });
  });

  it("aborts in-flight requests on dispose", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const refiner = new GoogleRefiner(cfg());
    const request = refiner.refine("raw");

    refiner.dispose();

    await expect(request).rejects.toMatchObject({ kind: "timeout" });
  });
});
