/**
 * Unit A — Configuration resolution.
 *
 * Responsibilities:
 *   1. Parse argv via commander (binary name: `mic-tool`).
 *   2. For every configurable value, resolve through the four-tier env-var
 *      chain (highest priority first):
 *        a. CLI flag
 *        b. `<CWD>/.env`
 *        c. `~/.tool-agents/mic-tool/.env`
 *        d. shell environment
 *      The chain lives in `./config/envChain.ts`. This module never mutates
 *      `process.env`.
 *   3. Validate the resolved values and return a frozen {@link ResolvedConfig}.
 *
 * No fallback values for missing required config (no API key etc.) — we throw
 * {@link MissingConfigurationError}. Invalid flag values throw
 * {@link InvalidConfigurationError}. LLM-specific startup misconfiguration
 * throws {@link LLMConfigurationError}. `--help` / `--version` surface as
 * {@link HelpOrVersionShown} sentinels so the orchestrator owns `process.exit`.
 */

import { createRequire } from "node:module";
import { Command, CommanderError } from "commander";

import {
  InvalidConfigurationError,
  LLMConfigurationError,
  MissingConfigurationError,
} from "./errors.js";
import { loadEnvChain, type EnvChain } from "./config/envChain.js";
import {
  parseBoolean,
  parseCsvNonEmpty,
  parseIsoDate,
  parsePositiveInt,
  parseWsUrl,
} from "./config/parsers.js";
import {
  LLM_PROVIDERS,
  type LLMConfig,
  type LLMProvider,
  type ProviderConfig,
} from "./llm/types.js";

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

export type OutputMode = "overwrite" | "append" | "final-only";

export interface ResolvedConfig {
  // ---- Soniox transcription ----
  /** Soniox API key. Guaranteed non-empty after trim. */
  readonly apiKey: string;
  /** Optional YYYY-MM-DD reminder for SONIOX_API_KEY renewal. */
  readonly apiKeyExpiresAt?: string;
  /** Soniox real-time model name. Default: "stt-rt-v4". */
  readonly model: string;
  /** Soniox WebSocket endpoint (wss://...). Default: SDK production endpoint. */
  readonly endpoint: string;
  /** Language hints (ISO 639-1/2 codes) OR the single literal "auto". */
  readonly languages: string[];
  /** PCM sample rate fed to sox and to Soniox (Hz). Default: 16000. */
  readonly sampleRate: number;
  /** Whether to enable Soniox server-side endpoint detection. Default: true. */
  readonly enableEndpointDetection: boolean;
  // ---- Rendering & turn detection ----
  /** Stdout rendering mode. */
  readonly outputMode: OutputMode;
  /** Guard phrase that closes the current turn. Non-empty after normalization. */
  readonly guardPhrase: string;
  // ---- LLM refinement ----
  readonly llm: LLMConfig;
  // ---- Diagnostics ----
  readonly verbose: boolean;
}

/**
 * Sentinel thrown when commander prints help or the version and would
 * otherwise have exited the process. The orchestrator should map this to
 * exit code 0 without printing anything extra (commander already wrote to
 * stdout).
 */
export class HelpOrVersionShown extends Error {
  public readonly kind: "help" | "version";
  constructor(kind: "help" | "version") {
    super(`commander displayed ${kind}`);
    this.name = "HelpOrVersionShown";
    this.kind = kind;
  }
}

// ----------------------------------------------------------------------------
// Defaults and constants
// ----------------------------------------------------------------------------

const TOOL_NAME = "mic-tool";

const OUTPUT_MODE_VALUES: readonly OutputMode[] = [
  "overwrite",
  "append",
  "final-only",
] as const;

const LANGUAGE_REGEX = /^[a-z]{2,3}(-[A-Z]{2})?$/;

const SONIOX_ENV_KEY = "SONIOX_API_KEY";
const SONIOX_EXPIRES_ENV = "SONIOX_API_KEY_EXPIRES_AT";

const DEFAULT_MODEL = "stt-rt-v4";
const DEFAULT_ENDPOINT = "wss://stt-rt.soniox.com/transcribe-websocket";
const DEFAULT_LANGUAGES_CSV = "el,en";
const DEFAULT_SAMPLE_RATE = 16000;
const SAMPLE_RATE_MIN = 8000;
const SAMPLE_RATE_MAX = 48000;
const DEFAULT_OUTPUT_MODE: OutputMode = "overwrite";
const DEFAULT_GUARD_PHRASE = "τέλος εντολής";

const DEFAULT_LLM_PROVIDER: LLMProvider = "azure-openai";
const DEFAULT_LLM_MODEL = "gpt-5.4";
const DEFAULT_LLM_REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_AZURE_API_VERSION = "2024-10-21";

const DEFAULT_SYSTEM_PROMPT =
  "You are a transcript-cleanup assistant. The input is a verbatim transcript of someone speaking and may contain disfluencies, filler words, false starts, and grammatical noise. Rewrite the text so it is grammatically correct and easy to read, preserving the speaker's meaning AND the original language. Respond with ONLY the cleaned text — no preamble, no quotes, no markdown, no explanation.";

// Note: .env file parsing and the four-tier env-var resolution chain live in
// `./config/envChain.ts`. This module imports `loadEnvChain` and consults the
// resulting `EnvChain` whenever it needs a non-flag value.

// ----------------------------------------------------------------------------
// Version lookup (from package.json)
// ----------------------------------------------------------------------------

function readPackageVersion(): string {
  const requireFromHere = createRequire(import.meta.url);
  const pkg = requireFromHere("../package.json") as { version?: unknown };
  if (typeof pkg.version !== "string" || pkg.version.length === 0) {
    throw new Error("package.json is missing a 'version' field");
  }
  return pkg.version;
}

// ----------------------------------------------------------------------------
// CLI parser
// ----------------------------------------------------------------------------

interface ParsedCliOptions {
  // Optional fields are `undefined` when the user did not supply the flag — in
  // that case the env-chain is consulted; otherwise the flag value wins.
  apiKey?: string;
  apiKeyExpiresAt?: string;
  model?: string;
  endpoint?: string;
  language?: string[]; // commander variadic; undefined when not passed
  sampleRate?: string;
  endpointDetection?: boolean; // false when --no-endpoint-detection was passed
  outputMode?: string;
  guardPhrase?: string;
  verbose?: boolean;
  refine?: boolean;
  llmProvider?: string;
  llmModel?: string;
}

function parseCli(argv: string[], version: string): ParsedCliOptions {
  const program = new Command();
  program
    .name(TOOL_NAME)
    .description(
      "Stream microphone audio to the Soniox real-time STT API and print transcripts to stdout.",
    )
    .version(version, "-V, --version", "Print the mic-tool version and exit.")
    .helpOption("-h, --help", "Show this help message and exit.")
    .addHelpText(
      "after",
      [
        "",
        "Configuration sources (highest priority first):",
        "  1. CLI flag",
        "  2. <cwd>/.env",
        "  3. ~/.tool-agents/mic-tool/.env",
        "  4. shell environment",
        "",
        "Examples:",
        "  $ mic-tool --api-key sk_... --language el --language en",
        "  $ SONIOX_API_KEY=sk_... mic-tool --output-mode append",
        "  $ mic-tool --no-refine                       # disable LLM refinement",
        "  $ mic-tool --language auto                   # let Soniox auto-detect",
        "",
      ].join("\n"),
    )
    // Soniox transcription
    .option("--api-key <value>", "Soniox API key. Env: SONIOX_API_KEY.")
    .option(
      "--api-key-expires-at <YYYY-MM-DD>",
      "Reminder date for SONIOX_API_KEY renewal. Env: SONIOX_API_KEY_EXPIRES_AT.",
    )
    .option(
      "--model <name>",
      "Soniox real-time model. Env: MIC_TOOL_MODEL.",
    )
    .option(
      "--endpoint <wss-url>",
      "Soniox WebSocket endpoint. Env: MIC_TOOL_ENDPOINT.",
    )
    .option(
      "--language <code>",
      "Language hint (ISO 639-1/2) or 'auto'. Repeat for multiple. Env: MIC_TOOL_LANGUAGES (comma-separated).",
      collectLanguage,
    )
    .option(
      "--sample-rate <hz>",
      "PCM sample rate (8000-48000). Env: MIC_TOOL_SAMPLE_RATE.",
    )
    .option(
      "--no-endpoint-detection",
      "Disable Soniox server-side endpoint detection. Env: MIC_TOOL_ENABLE_ENDPOINT_DETECTION.",
    )
    // Rendering / turn detection
    .option(
      "--output-mode <mode>",
      `Stdout rendering mode. One of: ${OUTPUT_MODE_VALUES.join(", ")}. Env: MIC_TOOL_OUTPUT_MODE.`,
    )
    .option(
      "--guard-phrase <phrase>",
      "Phrase that closes the current turn. Env: MIC_TOOL_GUARD_PHRASE.",
    )
    // LLM refinement
    .option("--refine", "Enable LLM refinement (default: on). Env: MIC_TOOL_REFINE.")
    .option("--no-refine", "Disable LLM refinement.")
    .option(
      "--llm-provider <name>",
      `LLM provider. One of: ${LLM_PROVIDERS.join(", ")}. Env: MIC_TOOL_LLM_PROVIDER.`,
    )
    .option(
      "--llm-model <name>",
      "LLM model / deployment name (provider-specific). Env: MIC_TOOL_LLM_MODEL.",
    )
    // Diagnostics
    .option("-v, --verbose", "Emit diagnostic logs to stderr. Env: MIC_TOOL_VERBOSE.");

  program.exitOverride();
  program.configureOutput({
    writeErr: (str) => process.stderr.write(str),
  });

  try {
    program.parse(argv);
  } catch (err) {
    if (err instanceof CommanderError) {
      if (err.code === "commander.helpDisplayed" || err.code === "commander.help") {
        throw new HelpOrVersionShown("help");
      }
      if (err.code === "commander.version") {
        throw new HelpOrVersionShown("version");
      }
      throw new InvalidConfigurationError(err.message, { cause: err });
    }
    throw err;
  }

  const opts = program.opts<ParsedCliOptions & { endpointDetection?: boolean }>();
  return opts;
}

function collectLanguage(value: string, prev?: string[]): string[] {
  return prev !== undefined ? [...prev, value] : [value];
}

// ----------------------------------------------------------------------------
// Validators
// ----------------------------------------------------------------------------

function validateLanguages(values: string[]): string[] {
  const out: string[] = [];
  for (const raw of values) {
    const v = raw.trim();
    if (v === "auto") {
      out.push("auto");
      continue;
    }
    if (!LANGUAGE_REGEX.test(v)) {
      throw new InvalidConfigurationError(
        `--language must be 'auto' or an ISO 639-1/2 code (e.g. 'en', 'es', 'pt-BR'). Got: '${raw}'.`,
      );
    }
    out.push(v);
  }
  if (out.includes("auto") && out.length > 1) {
    throw new InvalidConfigurationError(
      "--language 'auto' cannot be combined with other language hints.",
    );
  }
  return out;
}

function validateOutputMode(value: string): OutputMode {
  if ((OUTPUT_MODE_VALUES as readonly string[]).includes(value)) {
    return value as OutputMode;
  }
  throw new InvalidConfigurationError(
    `--output-mode must be one of: ${OUTPUT_MODE_VALUES.join(", ")}. Got: '${value}'.`,
  );
}

export function normalizeGuardPhrase(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function validateGuardPhrase(value: string): string {
  const v = value.trim();
  if (v.length === 0) {
    throw new InvalidConfigurationError("--guard-phrase must not be empty.");
  }
  if (normalizeGuardPhrase(v).length === 0) {
    throw new InvalidConfigurationError(
      `--guard-phrase must contain at least one letter or digit after normalization. Got: '${value}'.`,
    );
  }
  return v;
}

function validateLLMProvider(value: string): LLMProvider {
  if ((LLM_PROVIDERS as readonly string[]).includes(value)) {
    return value as LLMProvider;
  }
  throw new InvalidConfigurationError(
    `--llm-provider must be one of: ${LLM_PROVIDERS.join(", ")}. Got: '${value}'.`,
  );
}

function resolveProviderConfig(
  provider: LLMProvider,
  model: string,
  chain: EnvChain,
): ProviderConfig {
  if (provider === "azure-openai") {
    const apiKey = chain.value("AZURE_OPENAI_API_KEY");
    const endpoint = chain.value("AZURE_OPENAI_ENDPOINT");
    const deployment = chain.value("AZURE_OPENAI_DEPLOYMENT") ?? model;
    const apiVersion =
      chain.value("AZURE_OPENAI_API_VERSION") ?? DEFAULT_AZURE_API_VERSION;

    const missing: string[] = [];
    if (apiKey === undefined) missing.push("AZURE_OPENAI_API_KEY");
    if (endpoint === undefined) missing.push("AZURE_OPENAI_ENDPOINT");
    if (missing.length > 0) {
      throw new LLMConfigurationError(
        `Azure OpenAI is enabled (--refine on, --llm-provider=azure-openai) but the following env vars are not set in any of: CLI flag, ./.env, ~/.tool-agents/mic-tool/.env, shell env — ${missing.join(", ")}. Set them or run with --no-refine to disable LLM refinement.`,
      );
    }
    return {
      provider: "azure-openai",
      apiKey: apiKey as string,
      endpoint: endpoint as string,
      deployment,
      apiVersion,
    };
  }
  return { provider };
}

// ----------------------------------------------------------------------------
// Public entry point
// ----------------------------------------------------------------------------

/**
 * Resolve CLI args + the four-tier env-var chain into a frozen
 * {@link ResolvedConfig}. See module header for full precedence rules.
 */
export function resolveConfig(argv: string[]): ResolvedConfig {
  const version = readPackageVersion();
  const parsed = parseCli(argv, version);
  const chain = loadEnvChain({ toolName: TOOL_NAME });

  // ---- Soniox API key (required) -----------------------------------------
  let apiKey: string;
  let apiKeySource: "flag" | ".env" | "user" | "env";
  if (typeof parsed.apiKey === "string" && parsed.apiKey.trim().length > 0) {
    apiKey = parsed.apiKey.trim();
    apiKeySource = "flag";
  } else {
    const found = chain.get(SONIOX_ENV_KEY);
    if (found === null) {
      throw new MissingConfigurationError(
        "SONIOX_API_KEY is not set. Provide via --api-key flag, .env file (SONIOX_API_KEY=...), ~/.tool-agents/mic-tool/.env, or shell environment variable.",
      );
    }
    apiKey = found.value;
    apiKeySource = found.source;
  }

  // ---- Optional expiry reminder ------------------------------------------
  const apiKeyExpiresAtRaw =
    parsed.apiKeyExpiresAt ?? chain.value(SONIOX_EXPIRES_ENV);
  const apiKeyExpiresAt =
    apiKeyExpiresAtRaw === undefined
      ? undefined
      : parseIsoDate(
          apiKeyExpiresAtRaw,
          "--api-key-expires-at",
          SONIOX_EXPIRES_ENV,
        );

  // ---- Transcription parameters ------------------------------------------
  const model = resolveString(
    parsed.model,
    chain,
    "MIC_TOOL_MODEL",
    DEFAULT_MODEL,
  );
  const endpoint = parseWsUrl(
    resolveString(
      parsed.endpoint,
      chain,
      "MIC_TOOL_ENDPOINT",
      DEFAULT_ENDPOINT,
    ),
    "--endpoint",
    "MIC_TOOL_ENDPOINT",
  );

  // languages: array via flag (variadic), CSV via env var
  let languages: string[];
  if (parsed.language !== undefined && parsed.language.length > 0) {
    languages = parsed.language;
  } else {
    const fromEnv = chain.value("MIC_TOOL_LANGUAGES");
    languages = fromEnv !== undefined
      ? parseCsvNonEmpty(fromEnv, "--language", "MIC_TOOL_LANGUAGES")
      : parseCsvNonEmpty(
          DEFAULT_LANGUAGES_CSV,
          "--language",
          "MIC_TOOL_LANGUAGES",
        );
  }
  languages = validateLanguages(languages);

  const sampleRate = parsePositiveInt(
    resolveString(
      parsed.sampleRate,
      chain,
      "MIC_TOOL_SAMPLE_RATE",
      String(DEFAULT_SAMPLE_RATE),
    ),
    "--sample-rate",
    "MIC_TOOL_SAMPLE_RATE",
    SAMPLE_RATE_MIN,
    SAMPLE_RATE_MAX,
  );

  let enableEndpointDetection: boolean;
  if (parsed.endpointDetection === false) {
    // commander sets `endpointDetection: false` when --no-endpoint-detection
    // was passed; absent when neither was passed.
    enableEndpointDetection = false;
  } else {
    const envVal = chain.value("MIC_TOOL_ENABLE_ENDPOINT_DETECTION");
    enableEndpointDetection =
      envVal === undefined
        ? true
        : parseBoolean(
            envVal,
            "--no-endpoint-detection",
            "MIC_TOOL_ENABLE_ENDPOINT_DETECTION",
          );
  }

  // ---- Rendering / turn detection ----------------------------------------
  const outputMode = validateOutputMode(
    resolveString(
      parsed.outputMode,
      chain,
      "MIC_TOOL_OUTPUT_MODE",
      DEFAULT_OUTPUT_MODE,
    ),
  );
  const guardPhrase = validateGuardPhrase(
    resolveString(
      parsed.guardPhrase,
      chain,
      "MIC_TOOL_GUARD_PHRASE",
      DEFAULT_GUARD_PHRASE,
    ),
  );

  // ---- Verbose -----------------------------------------------------------
  let verbose: boolean;
  if (parsed.verbose === true) {
    verbose = true;
  } else {
    const v = chain.value("MIC_TOOL_VERBOSE");
    verbose = v === undefined ? false : parseBoolean(v, "--verbose", "MIC_TOOL_VERBOSE");
  }

  // ---- LLM refinement ----------------------------------------------------
  let llmEnabled: boolean;
  if (parsed.refine === true) {
    llmEnabled = true;
  } else if (parsed.refine === false) {
    llmEnabled = false;
  } else {
    const v = chain.value("MIC_TOOL_REFINE");
    llmEnabled = v === undefined ? true : parseBoolean(v, "--refine", "MIC_TOOL_REFINE");
  }
  const llmProvider = validateLLMProvider(
    resolveString(
      parsed.llmProvider,
      chain,
      "MIC_TOOL_LLM_PROVIDER",
      DEFAULT_LLM_PROVIDER,
    ),
  );
  const llmModel = resolveString(
    parsed.llmModel,
    chain,
    "MIC_TOOL_LLM_MODEL",
    DEFAULT_LLM_MODEL,
  ).trim();
  if (llmModel.length === 0) {
    throw new InvalidConfigurationError("--llm-model must not be empty.");
  }

  let providerConfig: ProviderConfig;
  if (llmEnabled) {
    providerConfig = resolveProviderConfig(llmProvider, llmModel, chain);
  } else {
    providerConfig =
      llmProvider === "azure-openai"
        ? {
            provider: "azure-openai",
            apiKey: "",
            endpoint: "",
            deployment: llmModel,
            apiVersion: DEFAULT_AZURE_API_VERSION,
          }
        : { provider: llmProvider };
  }

  const llm: LLMConfig = Object.freeze({
    enabled: llmEnabled,
    provider: llmProvider,
    model: llmModel,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    requestTimeoutMs: DEFAULT_LLM_REQUEST_TIMEOUT_MS,
    providerConfig,
    verbose,
  });

  if (verbose) {
    process.stderr.write(`[mic-tool] api key loaded from: ${apiKeySource}\n`);
    process.stderr.write(`[mic-tool] guard phrase: ${guardPhrase}\n`);
    process.stderr.write(
      `[mic-tool] transcription: model=${model}, endpoint=${endpoint}, languages=[${languages.join(", ")}], sample_rate=${sampleRate}, endpoint_detection=${enableEndpointDetection}\n`,
    );
    process.stderr.write(
      `[mic-tool] llm: ${llmEnabled ? "enabled" : "disabled"} (provider=${llmProvider}, model=${llmModel})\n`,
    );
  }

  return Object.freeze<ResolvedConfig>({
    apiKey,
    apiKeyExpiresAt,
    model,
    endpoint,
    languages,
    sampleRate,
    enableEndpointDetection,
    outputMode,
    guardPhrase,
    llm,
    verbose,
  });
}

// ----------------------------------------------------------------------------
// Resolution helpers
// ----------------------------------------------------------------------------

function resolveString(
  flagValue: string | undefined,
  chain: EnvChain,
  envKey: string,
  defaultValue: string,
): string {
  // Explicit flag (even empty) wins so downstream validators can reject it
  // — `mic-tool --guard-phrase ""` is a user error, not a silent fallback.
  if (flagValue !== undefined) {
    return flagValue;
  }
  const fromChain = chain.value(envKey);
  if (fromChain !== undefined) return fromChain;
  return defaultValue;
}

