/**
 * Google Gemini LLM refiner.
 *
 * Talks directly to the Gemini generateContent REST endpoint:
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 *        ?key={GOOGLE_API_KEY}
 *
 * No SDK dependency. The request uses systemInstruction for the configured
 * role prompt and a single user content part for the transcript text.
 */

import { LLMRefinementError } from "../errors.js";
import type {
  GoogleProviderConfig,
  LLMConfig,
  LLMRefiner,
} from "./types.js";

interface GenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export class GoogleRefiner implements LLMRefiner {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly systemPrompt: string;
  private readonly requestTimeoutMs: number;
  private readonly verbose: boolean;
  private readonly lifetimeAbort = new AbortController();
  private disposed = false;

  constructor(cfg: LLMConfig & { providerConfig: GoogleProviderConfig }) {
    this.apiKey = cfg.providerConfig.apiKey;
    this.model = cfg.model;
    this.systemPrompt = cfg.systemPrompt;
    this.requestTimeoutMs = cfg.requestTimeoutMs;
    this.verbose = cfg.verbose;
  }

  async refine(text: string): Promise<string> {
    if (this.disposed) {
      throw new LLMRefinementError(
        "Google refiner has been disposed",
        "network",
      );
    }

    const url = `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(
      this.model,
    )}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const ctrl = new AbortController();
    const onLifetimeAbort = (): void => ctrl.abort();
    this.lifetimeAbort.signal.addEventListener("abort", onLifetimeAbort);
    const timeoutHandle = setTimeout(
      () => ctrl.abort(new Error("LLM request timed out")),
      this.requestTimeoutMs,
    );

    const body = JSON.stringify({
      systemInstruction: {
        parts: [{ text: this.systemPrompt }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
      },
    });

    let response: Response;
    try {
      if (this.verbose) {
        process.stderr.write(
          `[untype] llm: refining ${text.length} chars via google/${this.model}\n`,
        );
      }
      response = await fetch(url, {
        method: "POST",
        headers: {
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

    let parsed: GenerateContentResponse;
    try {
      parsed = (await response.json()) as GenerateContentResponse;
    } catch (err) {
      throw new LLMRefinementError(
        `LLM response was not valid JSON: ${(err as Error).message}`,
        "shape",
        { cause: err },
      );
    }

    const textParts = parsed.candidates?.[0]?.content?.parts
      ?.map((part) => part.text)
      .filter((part): part is string => typeof part === "string");
    const content = textParts?.join("").trim();
    if (content === undefined || content.length === 0) {
      throw new LLMRefinementError(
        "LLM response did not contain non-empty candidates[0].content.parts[].text",
        "shape",
      );
    }
    return content;
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
