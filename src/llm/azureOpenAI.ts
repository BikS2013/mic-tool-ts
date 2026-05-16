/**
 * Azure OpenAI LLM refiner.
 *
 * Talks directly to the Chat Completions REST endpoint:
 *   POST {endpoint}/openai/deployments/{deployment}/chat/completions
 *        ?api-version={apiVersion}
 *   Headers: api-key: {key}, Content-Type: application/json
 *
 * No SDK dependency — `fetch` is built into Node 20+, and the protocol is
 * simple enough to express in ~40 lines. Cancellation and timeouts are
 * handled with a single `AbortController` per request, plus a class-level
 * controller that `dispose()` aborts to drop in-flight work at shutdown.
 *
 * Error mapping (HTTP → `LLMRefinementError.kind`):
 *   - 401, 403                       → "auth"
 *   - 408, 429, 5xx                  → "server"
 *   - timeout or network failure     → "network"/"timeout"
 *   - JSON parse / missing choice    → "shape"
 */

import { LLMRefinementError } from "../errors.js";
import type {
  AzureOpenAIProviderConfig,
  LLMConfig,
  LLMRefiner,
} from "./types.js";

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export class AzureOpenAIRefiner implements LLMRefiner {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly deployment: string;
  private readonly apiVersion: string;
  private readonly systemPrompt: string;
  private readonly requestTimeoutMs: number;
  private readonly verbose: boolean;
  private readonly lifetimeAbort = new AbortController();
  private disposed = false;

  constructor(cfg: LLMConfig & { providerConfig: AzureOpenAIProviderConfig }) {
    const p = cfg.providerConfig;
    // Strip trailing slashes from endpoint so URL concatenation is predictable.
    this.endpoint = p.endpoint.replace(/\/+$/, "");
    this.apiKey = p.apiKey;
    this.deployment = p.deployment;
    this.apiVersion = p.apiVersion;
    this.systemPrompt = cfg.systemPrompt;
    this.requestTimeoutMs = cfg.requestTimeoutMs;
    this.verbose = cfg.verbose;
  }

  async refine(text: string): Promise<string> {
    if (this.disposed) {
      throw new LLMRefinementError(
        "Azure OpenAI refiner has been disposed",
        "network",
      );
    }

    const url = `${this.endpoint}/openai/deployments/${encodeURIComponent(
      this.deployment,
    )}/chat/completions?api-version=${encodeURIComponent(this.apiVersion)}`;

    // Per-request controller wired to the class-level controller so dispose
    // aborts every in-flight request at once.
    const ctrl = new AbortController();
    const onLifetimeAbort = (): void => ctrl.abort();
    this.lifetimeAbort.signal.addEventListener("abort", onLifetimeAbort);
    const timeoutHandle = setTimeout(
      () => ctrl.abort(new Error("LLM request timed out")),
      this.requestTimeoutMs,
    );

    const body = JSON.stringify({
      messages: [
        { role: "system", content: this.systemPrompt },
        { role: "user", content: text },
      ],
      temperature: 0.2,
    });

    let response: Response;
    try {
      if (this.verbose) {
        process.stderr.write(
          `[mic-tool] llm: refining ${text.length} chars via azure-openai/${this.deployment}\n`,
        );
      }
      response = await fetch(url, {
        method: "POST",
        headers: {
          "api-key": this.apiKey,
          "Content-Type": "application/json",
        },
        body,
        signal: ctrl.signal,
      });
    } catch (err) {
      const kind: "timeout" | "network" =
        (err as Error).name === "AbortError" ||
        (err as Error).message?.includes("timed out")
          ? "timeout"
          : "network";
      throw new LLMRefinementError(
        `LLM request ${kind}: ${(err as Error).message}`,
        kind,
        { cause: err },
      );
    } finally {
      clearTimeout(timeoutHandle);
      this.lifetimeAbort.signal.removeEventListener("abort", onLifetimeAbort);
    }

    if (!response.ok) {
      const status = response.status;
      const errBody = await safeReadText(response);
      const kind: "auth" | "server" =
        status === 401 || status === 403 ? "auth" : "server";
      throw new LLMRefinementError(
        `LLM HTTP ${status}: ${truncate(errBody, 200)}`,
        kind,
      );
    }

    let parsed: ChatCompletionResponse;
    try {
      parsed = (await response.json()) as ChatCompletionResponse;
    } catch (err) {
      throw new LLMRefinementError(
        `LLM response was not valid JSON: ${(err as Error).message}`,
        "shape",
        { cause: err },
      );
    }

    const content = parsed.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new LLMRefinementError(
        "LLM response did not contain a non-empty choices[0].message.content",
        "shape",
      );
    }
    return content.trim();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (!this.lifetimeAbort.signal.aborted) {
      this.lifetimeAbort.abort(new Error("refiner disposed"));
    }
  }
}

async function safeReadText(r: Response): Promise<string> {
  try {
    return await r.text();
  } catch {
    return "<unreadable body>";
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}
