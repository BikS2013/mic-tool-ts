/**
 * Tests for src/config.ts — Unit A (resolveConfig).
 *
 * Each test isolates:
 *   - process.env (SONIOX_API_KEY only, restored in afterEach)
 *   - process.cwd() — mocked to a fresh tmpdir holding the .env file (if any)
 *   - process.stderr.write — captured for verbose-flag side-effect assertions
 *
 * We do NOT use chdir() here because it mutates global process state
 * non-atomically and is unsafe for parallel test runners. Instead we mock
 * process.cwd() via vi.spyOn so each test gets its own isolated cwd value.
 *
 * Tests cover (AC-4, AC-7, FR-5, NFR-5 from the refined request):
 *   - API-key precedence: flag > .env > shell env
 *   - MissingConfigurationError when no source provides a key
 *   - InvalidConfigurationError on invalid --language / --output-mode
 *   - Default values (language='en', outputMode='overwrite', verbose=false)
 *   - --verbose flag emits diagnostic to stderr (not stdout)
 *   - HelpOrVersionShown sentinel for --help / --version
 *   - Whitespace-only values treated as absent
 *   - .env file parsing edge cases (comments, export prefix, quoted values)
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HelpOrVersionShown,
  resolveConfig,
  type ResolvedConfig,
} from "../src/config.js";
import {
  InvalidConfigurationError,
  MissingConfigurationError,
} from "../src/errors.js";

// ---------------------------------------------------------------------------
// Test-wide helpers
// ---------------------------------------------------------------------------

/** Build an argv array as commander expects: ["node", "mic-tool-ts", ...flags].
 *  Defaults to `--no-refine` so existing tests that don't care about the LLM
 *  feature aren't forced to set Azure OpenAI env vars. Tests that exercise
 *  refinement behavior use `argvRefine()` instead. */
function argv(...flags: string[]): string[] {
  return ["node", "mic-tool-ts", "--no-refine", ...flags];
}

/** argv for tests that need refinement enabled. Caller is responsible for
 *  setting the Azure OpenAI env vars (or expecting the LLMConfigurationError). */
function argvRefine(...flags: string[]): string[] {
  return ["node", "mic-tool-ts", ...flags];
}

/** Create a temp directory, optionally writing a .env file into it, and
 *  return the directory path. The caller is responsible for cleanup. */
function makeTmpdir(dotenvContents?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "mic-tool-ts-test-"));
  if (dotenvContents !== undefined) {
    writeFileSync(join(dir, ".env"), dotenvContents, "utf8");
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Per-test environment isolation
// ---------------------------------------------------------------------------

const TRACKED_ENV_KEYS = [
  "SONIOX_API_KEY",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_API_KEY_EXPIRES_AT",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_DEPLOYMENT",
  "AZURE_OPENAI_API_VERSION",
  "MIC_TOOL_TS_INTERACTION_MODE",
  "MIC_TOOL_TS_COMMAND_PHRASE",
  "MIC_TOOL_TS_SECTION_END_PHRASE",
  "MIC_TOOL_TS_SECTION_CANCEL_PHRASE",
  "MIC_TOOL_TS_LITERAL_NEXT_PHRASE",
  "MIC_TOOL_TS_REFINE_DEFAULT",
  "MIC_TOOL_TS_TRANSLATE_DEFAULT",
  "MIC_TOOL_TS_TRANSLATION_POLICY",
  "MIC_TOOL_TS_CLIPBOARD_DEFAULT",
  "MIC_TOOL_TS_INPUT_DEFAULT",
  "MIC_TOOL_TS_PROTOCOL_OUTPUT",
  "HOME",
] as const;
const originalEnv: Record<string, string | undefined> = {};
let tmpDir: string | null = null;
let tmpHome: string | null = null;
let cwdSpy: ReturnType<typeof vi.spyOn> | null = null;
let stderrChunks: string[] = [];
let stderrSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  // Snapshot and clear the env vars we care about, isolating from the host.
  for (const k of TRACKED_ENV_KEYS) {
    originalEnv[k] = process.env[k];
    delete process.env[k];
  }

  // Point HOME at a clean tmpdir so loadEnvChain's user tier sees no file.
  tmpHome = mkdtempSync(join(tmpdir(), "mic-tool-ts-home-"));
  process.env["HOME"] = tmpHome;

  // Capture stderr writes (for verbose tests)
  stderrChunks = [];
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((
    chunk: Uint8Array | string,
  ) => {
    stderrChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  });
});

afterEach(() => {
  // Restore the env vars we touched.
  for (const k of TRACKED_ENV_KEYS) {
    const v = originalEnv[k];
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }

  // Restore cwd
  cwdSpy?.mockRestore();
  cwdSpy = null;

  // Restore stderr
  stderrSpy?.mockRestore();
  stderrSpy = null;

  // Clean up temp dirs
  if (tmpDir !== null) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
  if (tmpHome !== null) {
    rmSync(tmpHome, { recursive: true, force: true });
    tmpHome = null;
  }
});

/** Point process.cwd() at a directory (optionally containing a .env file). */
function setCwd(dotenvContents?: string): void {
  tmpDir = makeTmpdir(dotenvContents);
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
}

/** Set the shell SONIOX_API_KEY env var for the duration of the test. */
function setShellKey(value: string): void {
  process.env["SONIOX_API_KEY"] = value;
}

// ---------------------------------------------------------------------------
// 1. Default values
// ---------------------------------------------------------------------------

describe("resolveConfig — default values", () => {
  it("returns correct defaults for language, outputMode, verbose, guardPhrase when only --api-key is supplied", () => {
    setCwd(); // no .env file
    const cfg: ResolvedConfig = resolveConfig(argv("--api-key", "sk_test"));
    // Default languages now el,en (matches per-user .env doc).
    expect(cfg.languages).toEqual(["el", "en"]);
    expect(cfg.outputMode).toBe("overwrite");
    expect(cfg.verbose).toBe(false);
    expect(cfg.apiKey).toBe("sk_test");
    expect(cfg.sttProvider).toBe("soniox");
    expect(cfg.apiKeyEnvName).toBe("SONIOX_API_KEY");
    expect(cfg.guardPhrase).toBe("τέλος εντολής");
    expect(cfg.protocol.interactionMode).toBe("dictation");
    expect(cfg.protocol.markers.commandPhrase).toBe("command");
    expect(cfg.protocol.markers.sectionEndPhrase).toBe("command send");
    expect(cfg.protocol.markers.sectionEndAliases).toEqual(["τέλος εντολής"]);
    expect(cfg.protocol.markers.sectionCancelPhrase).toBe("command cancel");
    expect(cfg.protocol.markers.literalNextPhrase).toBe("literal phrase");
    expect(cfg.protocol.initialOperators).toEqual({
      refine: false,
      translate: false,
      clipboard: false,
      input: false,
    });
    expect(cfg.protocol.translationPolicy).toBe("opposite");
    expect(cfg.protocol.protocolOutput).toBeUndefined();
    expect(cfg.model).toBe("stt-rt-v4");
    expect(cfg.endpoint).toBe(
      "wss://stt-rt.soniox.com/transcribe-websocket",
    );
    expect(cfg.sampleRate).toBe(16000);
    expect(cfg.enableEndpointDetection).toBe(true);
    expect(cfg.apiKeyExpiresAt).toBeUndefined();
  });

  it("returned config object is frozen (immutable)", () => {
    setCwd();
    const cfg = resolveConfig(argv("--api-key", "sk_test"));
    expect(Object.isFrozen(cfg)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. API-key precedence chain
// ---------------------------------------------------------------------------

describe("resolveConfig — API-key precedence chain (FR-5 / AC-7)", () => {
  it("CLI flag wins over both .env and shell env", () => {
    setCwd("SONIOX_API_KEY=sk_from_dotenv\n");
    setShellKey("sk_from_shell");
    const cfg = resolveConfig(argv("--api-key", "sk_from_flag"));
    expect(cfg.apiKey).toBe("sk_from_flag");
    expect(cfg.apiKeySource).toBe("flag");
  });

  it(".env wins over shell env when no flag is provided", () => {
    setCwd("SONIOX_API_KEY=sk_from_dotenv\n");
    setShellKey("sk_from_shell");
    const cfg = resolveConfig(argv());
    expect(cfg.apiKey).toBe("sk_from_dotenv");
    expect(cfg.apiKeySource).toBe(".env");
  });

  it("shell env is used when no flag and no .env file exists", () => {
    setCwd(); // no .env
    setShellKey("sk_from_shell");
    const cfg = resolveConfig(argv());
    expect(cfg.apiKey).toBe("sk_from_shell");
    expect(cfg.apiKeySource).toBe("env");
  });

  it(".env key is trimmed before being used", () => {
    setCwd("SONIOX_API_KEY=  sk_trimmed  \n");
    const cfg = resolveConfig(argv());
    expect(cfg.apiKey).toBe("sk_trimmed");
  });

  it("flag key is trimmed before being used", () => {
    setCwd();
    const cfg = resolveConfig(argv("--api-key", "  sk_flag_trim  "));
    expect(cfg.apiKey).toBe("sk_flag_trim");
  });

  it("shell env key is trimmed before being used", () => {
    setCwd();
    setShellKey("  sk_shell_trim  ");
    const cfg = resolveConfig(argv());
    expect(cfg.apiKey).toBe("sk_shell_trim");
  });
});

// ---------------------------------------------------------------------------
// 2b. STT provider selection
// ---------------------------------------------------------------------------

describe("resolveConfig — STT provider selection", () => {
  it("defaults to Soniox and keeps Soniox defaults", () => {
    setCwd();
    setShellKey("sk_soniox");
    const cfg = resolveConfig(argv());
    expect(cfg.sttProvider).toBe("soniox");
    expect(cfg.apiKeyEnvName).toBe("SONIOX_API_KEY");
    expect(cfg.apiKey).toBe("sk_soniox");
    expect(cfg.model).toBe("stt-rt-v4");
    expect(cfg.endpoint).toBe("wss://stt-rt.soniox.com/transcribe-websocket");
    expect(cfg.languages).toEqual(["el", "en"]);
  });

  it("uses ElevenLabs when --stt-provider elevenlabs is selected", () => {
    setCwd();
    const cfg = resolveConfig(
      argv(
        "--stt-provider",
        "elevenlabs",
        "--elevenlabs-api-key",
        "xi_test",
      ),
    );
    expect(cfg.sttProvider).toBe("elevenlabs");
    expect(cfg.apiKeyEnvName).toBe("ELEVENLABS_API_KEY");
    expect(cfg.apiKey).toBe("xi_test");
    expect(cfg.model).toBe("scribe_v2_realtime");
    expect(cfg.endpoint).toBe(
      "wss://api.elevenlabs.io/v1/speech-to-text/realtime",
    );
    expect(cfg.languages).toEqual(["auto"]);
  });

  it("does not require SONIOX_API_KEY when ElevenLabs is selected", () => {
    setCwd("ELEVENLABS_API_KEY=xi_from_dotenv\n");
    const cfg = resolveConfig(argv("--stt-provider", "elevenlabs"));
    expect(cfg.apiKey).toBe("xi_from_dotenv");
  });

  it("throws MissingConfigurationError when ElevenLabs is selected without ELEVENLABS_API_KEY", () => {
    setCwd();
    expect(() =>
      resolveConfig(argv("--stt-provider", "elevenlabs")),
    ).toThrowError(MissingConfigurationError);
  });

  it("rejects an unknown --stt-provider", () => {
    setCwd();
    setShellKey("sk");
    expect(() =>
      resolveConfig(argv("--stt-provider", "other")),
    ).toThrowError(InvalidConfigurationError);
  });

  it("rejects multiple language hints for ElevenLabs", () => {
    setCwd("ELEVENLABS_API_KEY=xi\n");
    expect(() =>
      resolveConfig(
        argv(
          "--stt-provider",
          "elevenlabs",
          "--language",
          "el",
          "--language",
          "en",
        ),
      ),
    ).toThrowError(InvalidConfigurationError);
  });

  it("accepts a single explicit language hint for ElevenLabs", () => {
    setCwd("ELEVENLABS_API_KEY=xi\n");
    const cfg = resolveConfig(
      argv("--stt-provider", "elevenlabs", "--language", "en"),
    );
    expect(cfg.languages).toEqual(["en"]);
  });

  it("rejects unsupported ElevenLabs sample rates", () => {
    setCwd("ELEVENLABS_API_KEY=xi\n");
    expect(() =>
      resolveConfig(
        argv(
          "--stt-provider",
          "elevenlabs",
          "--sample-rate",
          "11025",
        ),
      ),
    ).toThrowError(InvalidConfigurationError);
  });

  it("round-trips ELEVENLABS_API_KEY_EXPIRES_AT into the active config", () => {
    setCwd(
      "ELEVENLABS_API_KEY=xi\nELEVENLABS_API_KEY_EXPIRES_AT=2027-02-01\n",
    );
    const cfg = resolveConfig(argv("--stt-provider", "elevenlabs"));
    expect(cfg.apiKeyExpiresAt).toBe("2027-02-01");
  });
});

// ---------------------------------------------------------------------------
// 3. MissingConfigurationError — no key found anywhere (AC-4 / NFR-5)
// ---------------------------------------------------------------------------

describe("resolveConfig — MissingConfigurationError (AC-4)", () => {
  it("throws MissingConfigurationError when no key in any source", () => {
    setCwd(); // no .env, no shell env, no flag
    expect(() => resolveConfig(argv())).toThrowError(MissingConfigurationError);
  });

  it("error message mentions SONIOX_API_KEY", () => {
    setCwd();
    expect(() => resolveConfig(argv())).toThrow(/SONIOX_API_KEY/);
  });

  it("whitespace-only .env value is treated as absent", () => {
    setCwd("SONIOX_API_KEY=   \n");
    expect(() => resolveConfig(argv())).toThrowError(MissingConfigurationError);
  });

  it("whitespace-only shell env value is treated as absent", () => {
    setCwd();
    setShellKey("   ");
    expect(() => resolveConfig(argv())).toThrowError(MissingConfigurationError);
  });

  it("whitespace-only --api-key flag value is treated as absent", () => {
    setCwd();
    // If shell + .env are also absent, this must raise
    expect(() => resolveConfig(argv("--api-key", "   "))).toThrowError(
      MissingConfigurationError,
    );
  });

  it("empty .env file (no key at all) causes MissingConfigurationError", () => {
    setCwd("# only a comment\n");
    expect(() => resolveConfig(argv())).toThrowError(MissingConfigurationError);
  });
});

// ---------------------------------------------------------------------------
// 4. --language validation
// ---------------------------------------------------------------------------

describe("resolveConfig — --language validation", () => {
  it("accepts 'auto'", () => {
    setCwd();
    setShellKey("sk");
    const cfg = resolveConfig(argv("--language", "auto"));
    expect(cfg.languages).toEqual(["auto"]);
  });

  it("accepts a 2-letter ISO 639-1 code (e.g. 'en')", () => {
    setCwd();
    setShellKey("sk");
    const cfg = resolveConfig(argv("--language", "en"));
    expect(cfg.languages).toEqual(["en"]);
  });

  it("accepts a 3-letter ISO 639-2 code (e.g. 'spa')", () => {
    setCwd();
    setShellKey("sk");
    const cfg = resolveConfig(argv("--language", "spa"));
    expect(cfg.languages).toEqual(["spa"]);
  });

  it("accepts a region-suffixed code (e.g. 'pt-BR')", () => {
    setCwd();
    setShellKey("sk");
    const cfg = resolveConfig(argv("--language", "pt-BR"));
    expect(cfg.languages).toEqual(["pt-BR"]);
  });

  it("accepts multiple --language flags and preserves order", () => {
    setCwd();
    setShellKey("sk");
    const cfg = resolveConfig(argv("--language", "el", "--language", "en"));
    expect(cfg.languages).toEqual(["el", "en"]);
  });

  it("rejects 'auto' combined with another language", () => {
    setCwd();
    setShellKey("sk");
    expect(() =>
      resolveConfig(argv("--language", "auto", "--language", "en")),
    ).toThrowError(InvalidConfigurationError);
  });

  it("loads languages from MIC_TOOL_TS_LANGUAGES csv env var when no --language flag", () => {
    setCwd("SONIOX_API_KEY=k\nMIC_TOOL_TS_LANGUAGES=fr,de,it\n");
    const cfg = resolveConfig(argv());
    expect(cfg.languages).toEqual(["fr", "de", "it"]);
  });

  it("rejects a plain English word ('english')", () => {
    setCwd();
    setShellKey("sk");
    expect(() => resolveConfig(argv("--language", "english"))).toThrowError(
      InvalidConfigurationError,
    );
  });

  it("rejects an all-uppercase code ('EN')", () => {
    setCwd();
    setShellKey("sk");
    expect(() => resolveConfig(argv("--language", "EN"))).toThrowError(
      InvalidConfigurationError,
    );
  });

  it("rejects a numeric string", () => {
    setCwd();
    setShellKey("sk");
    expect(() => resolveConfig(argv("--language", "123"))).toThrowError(
      InvalidConfigurationError,
    );
  });
});

// ---------------------------------------------------------------------------
// 5. --output-mode validation
// ---------------------------------------------------------------------------

describe("resolveConfig — --output-mode validation", () => {
  it("accepts 'overwrite'", () => {
    setCwd();
    setShellKey("sk");
    const cfg = resolveConfig(argv("--output-mode", "overwrite"));
    expect(cfg.outputMode).toBe("overwrite");
  });

  it("accepts 'append'", () => {
    setCwd();
    setShellKey("sk");
    const cfg = resolveConfig(argv("--output-mode", "append"));
    expect(cfg.outputMode).toBe("append");
  });

  it("accepts 'final-only'", () => {
    setCwd();
    setShellKey("sk");
    const cfg = resolveConfig(argv("--output-mode", "final-only"));
    expect(cfg.outputMode).toBe("final-only");
  });

  it("rejects an unrecognized mode (e.g. 'weird')", () => {
    setCwd();
    setShellKey("sk");
    expect(() =>
      resolveConfig(argv("--output-mode", "weird")),
    ).toThrowError(InvalidConfigurationError);
  });

  it("rejects 'Overwrite' (case-sensitive check)", () => {
    setCwd();
    setShellKey("sk");
    expect(() =>
      resolveConfig(argv("--output-mode", "Overwrite")),
    ).toThrowError(InvalidConfigurationError);
  });
});

// ---------------------------------------------------------------------------
// 5b. --guard-phrase flag
// ---------------------------------------------------------------------------

describe("resolveConfig — --guard-phrase flag", () => {
  it("defaults to 'τέλος εντολής' (Greek 'end of command')", () => {
    setCwd();
    const cfg = resolveConfig(argv("--api-key", "sk_test"));
    expect(cfg.guardPhrase).toBe("τέλος εντολής");
  });

  it("accepts a custom phrase via --guard-phrase", () => {
    setCwd();
    const cfg = resolveConfig(
      argv("--api-key", "sk_test", "--guard-phrase", "over and out"),
    );
    expect(cfg.guardPhrase).toBe("over and out");
  });

  it("rejects an empty --guard-phrase", () => {
    setCwd();
    expect(() =>
      resolveConfig(argv("--api-key", "sk_test", "--guard-phrase", "")),
    ).toThrowError(InvalidConfigurationError);
  });

  it("rejects a --guard-phrase that normalizes to empty (punctuation only)", () => {
    setCwd();
    expect(() =>
      resolveConfig(
        argv("--api-key", "sk_test", "--guard-phrase", "!!! ??? ..."),
      ),
    ).toThrowError(InvalidConfigurationError);
  });

  it("logs the active guard phrase under --verbose (no key value leaked)", () => {
    setCwd();
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    resolveConfig(
      argv("--api-key", "sk_secret", "--verbose", "--guard-phrase", "stop"),
    );
    const stderrCalls = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrCalls).toContain("guard phrase: stop");
    expect(stderrCalls).not.toContain("sk_secret");
    stderr.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 5c. LLM refinement config (--refine / --no-refine / --llm-provider / --llm-model)
// ---------------------------------------------------------------------------

describe("resolveConfig — LLM refinement defaults", () => {
  it("--refine is ON by default (so existing tests use --no-refine for isolation)", () => {
    setCwd();
    // Provide the Azure env vars so the default-refine path resolves cleanly.
    process.env["AZURE_OPENAI_API_KEY"] = "az-key";
    process.env["AZURE_OPENAI_ENDPOINT"] = "https://x.openai.azure.com";
    const cfg = resolveConfig(argvRefine("--api-key", "sk_test"));
    expect(cfg.llm.enabled).toBe(true);
    expect(cfg.llm.provider).toBe("azure-openai");
    expect(cfg.llm.model).toBe("gpt-5.4");
  });

  it("--no-refine disables LLM refinement and skips env-var validation", () => {
    setCwd();
    const cfg = resolveConfig(argv("--api-key", "sk_test"));
    expect(cfg.llm.enabled).toBe(false);
  });

  it("throws LLMConfigurationError when --refine is on but Azure env vars are missing", () => {
    setCwd();
    expect(() =>
      resolveConfig(argvRefine("--api-key", "sk_test")),
    ).toThrowError(/AZURE_OPENAI_API_KEY/);
  });

  it("can inspect resolved UI settings without requiring LLM provider secrets", () => {
    setCwd();
    const cfg = resolveConfig(argvRefine("--api-key", "sk_test"), {
      validateLlmProviderConfig: false,
    });
    expect(cfg.llm.enabled).toBe(true);
    expect(cfg.llm.provider).toBe("azure-openai");
    expect(cfg.apiKey).toBe("sk_test");
  });

  it("reads Azure OpenAI env vars from project-local .env", () => {
    setCwd(
      "AZURE_OPENAI_API_KEY=az-key\nAZURE_OPENAI_ENDPOINT=https://x.openai.azure.com\nAZURE_OPENAI_DEPLOYMENT=my-deploy\nAZURE_OPENAI_API_VERSION=2025-01-01-preview\n",
    );
    const cfg = resolveConfig(argvRefine("--api-key", "sk_test"));
    expect(cfg.llm.enabled).toBe(true);
    expect(cfg.llm.providerConfig.provider).toBe("azure-openai");
    if (cfg.llm.providerConfig.provider !== "azure-openai") {
      throw new Error("unreachable");
    }
    expect(cfg.llm.providerConfig.apiKey).toBe("az-key");
    expect(cfg.llm.providerConfig.endpoint).toBe("https://x.openai.azure.com");
    expect(cfg.llm.providerConfig.deployment).toBe("my-deploy");
    expect(cfg.llm.providerConfig.apiVersion).toBe("2025-01-01-preview");
  });

  it("falls back to default api-version when not provided", () => {
    setCwd(
      "AZURE_OPENAI_API_KEY=k\nAZURE_OPENAI_ENDPOINT=https://x.openai.azure.com\n",
    );
    const cfg = resolveConfig(argvRefine("--api-key", "sk_test"));
    if (cfg.llm.providerConfig.provider !== "azure-openai") {
      throw new Error("unreachable");
    }
    expect(cfg.llm.providerConfig.apiVersion).toBe("2024-10-21");
  });

  it("falls back to --llm-model as the deployment name when AZURE_OPENAI_DEPLOYMENT is absent", () => {
    setCwd(
      "AZURE_OPENAI_API_KEY=k\nAZURE_OPENAI_ENDPOINT=https://x.openai.azure.com\n",
    );
    const cfg = resolveConfig(
      argvRefine("--api-key", "sk_test", "--llm-model", "my-deploy"),
    );
    if (cfg.llm.providerConfig.provider !== "azure-openai") {
      throw new Error("unreachable");
    }
    expect(cfg.llm.providerConfig.deployment).toBe("my-deploy");
  });

  it("rejects an unknown --llm-provider", () => {
    setCwd();
    expect(() =>
      resolveConfig(argv("--api-key", "sk_test", "--llm-provider", "nope")),
    ).toThrowError(InvalidConfigurationError);
  });

  it("accepts every supported provider name (validation only)", () => {
    setCwd();
    for (const p of [
      "azure-openai",
      "openai",
      "anthropic",
      "google",
      "azure-ai-inference",
      "ollama",
      "litellm",
      "openai-compat",
    ]) {
      const cfg = resolveConfig(
        argv("--api-key", "sk_test", "--llm-provider", p),
      );
      expect(cfg.llm.provider).toBe(p);
    }
  });

  it("rejects an empty --llm-model", () => {
    setCwd();
    expect(() =>
      resolveConfig(argv("--api-key", "sk_test", "--llm-model", "  ")),
    ).toThrowError(InvalidConfigurationError);
  });
});

// ---------------------------------------------------------------------------
// 5d. New env-var aliases (MIC_TOOL_TS_*)
// ---------------------------------------------------------------------------

describe("resolveConfig — env-var aliases for every flag", () => {
  it("MIC_TOOL_TS_STT_PROVIDER selects ElevenLabs", () => {
    setCwd("MIC_TOOL_TS_STT_PROVIDER=elevenlabs\nELEVENLABS_API_KEY=xi\n");
    const cfg = resolveConfig(argv());
    expect(cfg.sttProvider).toBe("elevenlabs");
  });

  it("MIC_TOOL_TS_MODEL overrides the default model", () => {
    setCwd("SONIOX_API_KEY=k\nMIC_TOOL_TS_MODEL=stt-async-v3\n");
    const cfg = resolveConfig(argv());
    expect(cfg.model).toBe("stt-async-v3");
  });

  it("MIC_TOOL_TS_ENDPOINT overrides the default endpoint", () => {
    setCwd(
      "SONIOX_API_KEY=k\nMIC_TOOL_TS_ENDPOINT=wss://stt-rt.eu.soniox.com/transcribe-websocket\n",
    );
    const cfg = resolveConfig(argv());
    expect(cfg.endpoint).toBe(
      "wss://stt-rt.eu.soniox.com/transcribe-websocket",
    );
  });

  it("rejects a non-wss endpoint", () => {
    setCwd("SONIOX_API_KEY=k\nMIC_TOOL_TS_ENDPOINT=http://example.com\n");
    expect(() => resolveConfig(argv())).toThrowError(InvalidConfigurationError);
  });

  it("MIC_TOOL_TS_SAMPLE_RATE overrides default", () => {
    setCwd("SONIOX_API_KEY=k\nMIC_TOOL_TS_SAMPLE_RATE=24000\n");
    const cfg = resolveConfig(argv());
    expect(cfg.sampleRate).toBe(24000);
  });

  it("rejects sample rate below 8000", () => {
    setCwd("SONIOX_API_KEY=k\nMIC_TOOL_TS_SAMPLE_RATE=4000\n");
    expect(() => resolveConfig(argv())).toThrowError(InvalidConfigurationError);
  });

  it("rejects sample rate above 48000", () => {
    setCwd("SONIOX_API_KEY=k\nMIC_TOOL_TS_SAMPLE_RATE=96000\n");
    expect(() => resolveConfig(argv())).toThrowError(InvalidConfigurationError);
  });

  it("MIC_TOOL_TS_ENABLE_ENDPOINT_DETECTION=false disables endpoint detection", () => {
    setCwd("SONIOX_API_KEY=k\nMIC_TOOL_TS_ENABLE_ENDPOINT_DETECTION=false\n");
    const cfg = resolveConfig(argv());
    expect(cfg.enableEndpointDetection).toBe(false);
  });

  it("--no-endpoint-detection wins over env var", () => {
    setCwd("SONIOX_API_KEY=k\nMIC_TOOL_TS_ENABLE_ENDPOINT_DETECTION=true\n");
    const cfg = resolveConfig(argv("--no-endpoint-detection"));
    expect(cfg.enableEndpointDetection).toBe(false);
  });

  it("--endpoint-detection wins over env var", () => {
    setCwd("SONIOX_API_KEY=k\nMIC_TOOL_TS_ENABLE_ENDPOINT_DETECTION=false\n");
    const cfg = resolveConfig(argv("--endpoint-detection"));
    expect(cfg.enableEndpointDetection).toBe(true);
  });

  it("MIC_TOOL_TS_GUARD_PHRASE overrides the default", () => {
    setCwd('SONIOX_API_KEY=k\nMIC_TOOL_TS_GUARD_PHRASE="end command"\n');
    const cfg = resolveConfig(argv());
    expect(cfg.guardPhrase).toBe("end command");
  });

  it("MIC_TOOL_TS_OUTPUT_MODE overrides the default", () => {
    setCwd("SONIOX_API_KEY=k\nMIC_TOOL_TS_OUTPUT_MODE=append\n");
    const cfg = resolveConfig(argv());
    expect(cfg.outputMode).toBe("append");
  });

  it("MIC_TOOL_TS_VERBOSE=true enables verbose", () => {
    setCwd("SONIOX_API_KEY=k\nMIC_TOOL_TS_VERBOSE=true\n");
    const cfg = resolveConfig(argv());
    expect(cfg.verbose).toBe(true);
  });

  it("MIC_TOOL_TS_REFINE=false disables LLM refinement", () => {
    setCwd("SONIOX_API_KEY=k\nMIC_TOOL_TS_REFINE=false\n");
    const cfg = resolveConfig(argvRefine());
    expect(cfg.llm.enabled).toBe(false);
  });

  it("MIC_TOOL_TS_LLM_PROVIDER overrides the default provider", () => {
    setCwd("SONIOX_API_KEY=k\nMIC_TOOL_TS_REFINE=false\nMIC_TOOL_TS_LLM_PROVIDER=openai\n");
    const cfg = resolveConfig(argvRefine());
    expect(cfg.llm.provider).toBe("openai");
  });

  it("MIC_TOOL_TS_LLM_MODEL overrides the default model", () => {
    setCwd("SONIOX_API_KEY=k\nMIC_TOOL_TS_REFINE=false\nMIC_TOOL_TS_LLM_MODEL=my-deploy\n");
    const cfg = resolveConfig(argvRefine());
    expect(cfg.llm.model).toBe("my-deploy");
  });

  it("MIC_TOOL_TS_INTERACTION_MODE enables agent protocol mode", () => {
    setCwd("SONIOX_API_KEY=k\nMIC_TOOL_TS_INTERACTION_MODE=agent-protocol\n");
    const cfg = resolveConfig(argv());
    expect(cfg.protocol.interactionMode).toBe("agent-protocol");
  });

  it("resolves protocol phrases and operator defaults from env vars", () => {
    setCwd(
      [
        "SONIOX_API_KEY=k",
        "MIC_TOOL_TS_COMMAND_PHRASE=εντολή",
        "MIC_TOOL_TS_SECTION_END_PHRASE=τέλος",
        "MIC_TOOL_TS_SECTION_CANCEL_PHRASE=άκυρο",
        "MIC_TOOL_TS_LITERAL_NEXT_PHRASE=κυριολεκτικά",
        "MIC_TOOL_TS_REFINE_DEFAULT=on",
        "MIC_TOOL_TS_TRANSLATE_DEFAULT=yes",
        "MIC_TOOL_TS_CLIPBOARD_DEFAULT=1",
        "MIC_TOOL_TS_INPUT_DEFAULT=true",
        "MIC_TOOL_TS_TRANSLATION_POLICY=to-en",
      ].join("\n"),
    );
    const cfg = resolveConfig(argv());
    expect(cfg.protocol.markers.commandPhrase).toBe("εντολή");
    expect(cfg.protocol.markers.sectionEndPhrase).toBe("τέλος");
    expect(cfg.protocol.markers.sectionCancelPhrase).toBe("άκυρο");
    expect(cfg.protocol.markers.literalNextPhrase).toBe("κυριολεκτικά");
    expect(cfg.protocol.initialOperators).toEqual({
      refine: true,
      translate: true,
      clipboard: true,
      input: true,
    });
    expect(cfg.protocol.translationPolicy).toBe("to-en");
  });

  it("requires --protocol-output when hybrid mode is selected", () => {
    setCwd("SONIOX_API_KEY=k\n");
    expect(() =>
      resolveConfig(argv("--interaction-mode", "hybrid")),
    ).toThrowError(InvalidConfigurationError);
  });

  it("accepts --protocol-output in hybrid mode", () => {
    setCwd("SONIOX_API_KEY=k\n");
    const cfg = resolveConfig(
      argv(
        "--interaction-mode",
        "hybrid",
        "--protocol-output",
        "/tmp/mic-tool-ts-protocol.jsonl",
      ),
    );
    expect(cfg.protocol.interactionMode).toBe("hybrid");
    expect(cfg.protocol.protocolOutput).toBe("/tmp/mic-tool-ts-protocol.jsonl");
  });

  it("rejects an unknown interaction mode", () => {
    setCwd("SONIOX_API_KEY=k\n");
    expect(() =>
      resolveConfig(argv("--interaction-mode", "speechy")),
    ).toThrowError(InvalidConfigurationError);
  });

  it("SONIOX_API_KEY_EXPIRES_AT round-trips into the resolved config", () => {
    setCwd("SONIOX_API_KEY=k\nSONIOX_API_KEY_EXPIRES_AT=2027-01-15\n");
    const cfg = resolveConfig(argv());
    expect(cfg.apiKeyExpiresAt).toBe("2027-01-15");
  });

  it("rejects a malformed SONIOX_API_KEY_EXPIRES_AT", () => {
    setCwd("SONIOX_API_KEY=k\nSONIOX_API_KEY_EXPIRES_AT=tomorrow\n");
    expect(() => resolveConfig(argv())).toThrowError(InvalidConfigurationError);
  });
});

// ---------------------------------------------------------------------------
// 6. --verbose flag side effect
// ---------------------------------------------------------------------------

describe("resolveConfig — --verbose flag (FR-9)", () => {
  it("sets verbose=true in the returned config", () => {
    setCwd();
    setShellKey("sk_v");
    const cfg = resolveConfig(argv("--verbose"));
    expect(cfg.verbose).toBe(true);
  });

  it("short -v flag is accepted and sets verbose=true", () => {
    setCwd();
    setShellKey("sk_v");
    const cfg = resolveConfig(argv("-v"));
    expect(cfg.verbose).toBe(true);
  });

  it("when verbose=true, writes a diagnostic line to stderr", () => {
    setCwd();
    setShellKey("sk_v");
    resolveConfig(argv("--verbose"));
    const combined = stderrChunks.join("");
    expect(combined).toContain("[mic-tool-ts]");
  });

  it("when verbose=true, the stderr message does NOT contain the key value", () => {
    setCwd();
    setShellKey("super_secret_key_value");
    resolveConfig(argv("--verbose"));
    const combined = stderrChunks.join("");
    expect(combined).not.toContain("super_secret_key_value");
  });

  it("when verbose=true, the stderr message mentions the source of the key", () => {
    setCwd();
    setShellKey("sk_v");
    resolveConfig(argv("--verbose"));
    const combined = stderrChunks.join("");
    expect(combined).toMatch(/SONIOX_API_KEY loaded from: env/i);
  });

  it("when verbose=true with --api-key flag, stderr mentions 'flag' as source", () => {
    setCwd();
    resolveConfig(argv("--verbose", "--api-key", "sk_flag"));
    const combined = stderrChunks.join("");
    expect(combined).toMatch(/SONIOX_API_KEY loaded from: flag/i);
  });

  it("when verbose=false (default), nothing is written to stderr by resolveConfig", () => {
    setCwd();
    setShellKey("sk");
    resolveConfig(argv());
    expect(stderrChunks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7. HelpOrVersionShown sentinel (AC-2 / AC-3)
// ---------------------------------------------------------------------------

describe("resolveConfig — HelpOrVersionShown sentinel (AC-2, AC-3)", () => {
  it("--help throws HelpOrVersionShown with kind='help'", () => {
    setCwd();
    // Suppress commander's stdout write during help
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      expect(() => resolveConfig(argv("--help"))).toThrowError(HelpOrVersionShown);
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it("-h throws HelpOrVersionShown with kind='help'", () => {
    setCwd();
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      let caught: unknown;
      try {
        resolveConfig(argv("-h"));
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(HelpOrVersionShown);
      expect((caught as HelpOrVersionShown).kind).toBe("help");
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it("--version throws HelpOrVersionShown with kind='version'", () => {
    setCwd();
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      let caught: unknown;
      try {
        resolveConfig(argv("--version"));
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(HelpOrVersionShown);
      expect((caught as HelpOrVersionShown).kind).toBe("version");
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it("-V throws HelpOrVersionShown with kind='version'", () => {
    setCwd();
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      let caught: unknown;
      try {
        resolveConfig(argv("-V"));
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(HelpOrVersionShown);
      expect((caught as HelpOrVersionShown).kind).toBe("version");
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it("HelpOrVersionShown.name is 'HelpOrVersionShown'", () => {
    setCwd();
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      let caught: unknown;
      try {
        resolveConfig(argv("--help"));
      } catch (err) {
        caught = err;
      }
      expect((caught as Error).name).toBe("HelpOrVersionShown");
    } finally {
      stdoutSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// 8. .env file parsing edge cases
// ---------------------------------------------------------------------------

describe("resolveConfig — .env parsing edge cases", () => {
  it("ignores comment lines starting with #", () => {
    setCwd("# this is a comment\nSONIOX_API_KEY=sk_real\n");
    const cfg = resolveConfig(argv());
    expect(cfg.apiKey).toBe("sk_real");
  });

  it("handles 'export KEY=VALUE' syntax (strips export prefix)", () => {
    setCwd("export SONIOX_API_KEY=sk_exported\n");
    const cfg = resolveConfig(argv());
    expect(cfg.apiKey).toBe("sk_exported");
  });

  it("handles double-quoted values", () => {
    setCwd('SONIOX_API_KEY="sk_quoted"\n');
    const cfg = resolveConfig(argv());
    expect(cfg.apiKey).toBe("sk_quoted");
  });

  it("handles single-quoted values", () => {
    setCwd("SONIOX_API_KEY='sk_single_quoted'\n");
    const cfg = resolveConfig(argv());
    expect(cfg.apiKey).toBe("sk_single_quoted");
  });

  it("ignores blank lines between entries", () => {
    setCwd("\n\nSONIOX_API_KEY=sk_after_blanks\n\n");
    const cfg = resolveConfig(argv());
    expect(cfg.apiKey).toBe("sk_after_blanks");
  });

  it("inline comment on unquoted value is stripped", () => {
    setCwd("SONIOX_API_KEY=sk_value # this is inline comment\n");
    const cfg = resolveConfig(argv());
    expect(cfg.apiKey).toBe("sk_value");
  });

  it("returns null (no .env found) when no .env file exists — falls through to shell env", () => {
    setCwd(); // no .env written
    setShellKey("sk_shell_fallthrough");
    const cfg = resolveConfig(argv());
    expect(cfg.apiKey).toBe("sk_shell_fallthrough");
  });
});
