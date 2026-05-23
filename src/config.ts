/**
 * Unit A — Configuration resolution.
 *
 * Responsibilities:
 *   1. Parse argv via commander (binary name: `untype`).
 *   2. For every configurable value, resolve through the four-tier env-var
 *      chain (highest priority first):
 *        a. CLI flag
 *        b. `<CWD>/.env`
 *        c. `~/.tool-agents/untype/.env`
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

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { Command, CommanderError } from "commander";

import {
  InvalidConfigurationError,
  LLMConfigurationError,
  MissingConfigurationError,
} from "./errors.js";
import { loadEnvChain, type EnvChain, type EnvSource } from "./config/envChain.js";
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
import {
  STT_PROVIDERS,
  type SttProvider,
} from "./transcription/types.js";
import {
  INTERACTION_MODES,
  TRANSLATION_POLICIES,
  type InteractionMode,
  type ProtocolSettingSource,
  type ProtocolRuntimeConfig,
  type TranslationPolicy,
} from "./protocol/types.js";

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

export type OutputMode = "overwrite" | "append" | "final-only";

export interface ResolvedConfig {
  // ---- STT provider transcription ----
  /** Active realtime transcription provider. */
  readonly sttProvider: SttProvider;
  /** Active provider API key. Guaranteed non-empty after trim. */
  readonly apiKey: string;
  /** Active provider API-key env var name. */
  readonly apiKeyEnvName: "SONIOX_API_KEY" | "ELEVENLABS_API_KEY";
  /** Source tier that supplied the active provider API key. */
  readonly apiKeySource: EnvSource;
  /** Optional YYYY-MM-DD reminder for active provider API-key renewal. */
  readonly apiKeyExpiresAt?: string;
  /** Active provider realtime model name. */
  readonly model: string;
  /** Active provider WebSocket endpoint (wss://...). */
  readonly endpoint: string;
  /** Language hints (ISO 639-1/2/3 codes) OR the single literal "auto". */
  readonly languages: string[];
  /** PCM sample rate fed to sox and to the active STT provider (Hz). */
  readonly sampleRate: number;
  /** Whether to enable provider endpoint/VAD detection. Default: true. */
  readonly enableEndpointDetection: boolean;
  // ---- Rendering & turn detection ----
  /** Stdout rendering mode. */
  readonly outputMode: OutputMode;
  /** Guard phrase that closes the current turn. Non-empty after normalization. */
  readonly guardPhrase: string;
  /** Voice-agent command protocol configuration. */
  readonly protocol: ProtocolRuntimeConfig;
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

export interface ResolveConfigOptions {
  /**
   * When false, validates and reports the selected LLM provider/model without
   * requiring provider credentials. This is for non-secret UI inspection only;
   * runtime session startup keeps the default strict behavior.
   */
  readonly validateLlmProviderConfig?: boolean;
}

// ----------------------------------------------------------------------------
// Defaults and constants
// ----------------------------------------------------------------------------

const TOOL_NAME = "untype";

const OUTPUT_MODE_VALUES: readonly OutputMode[] = [
  "overwrite",
  "append",
  "final-only",
] as const;

const LANGUAGE_REGEX = /^[a-z]{2,3}(-[A-Z]{2})?$/;

const SONIOX_ENV_KEY = "SONIOX_API_KEY";
const SONIOX_EXPIRES_ENV = "SONIOX_API_KEY_EXPIRES_AT";
const ELEVENLABS_ENV_KEY = "ELEVENLABS_API_KEY";
const ELEVENLABS_EXPIRES_ENV = "ELEVENLABS_API_KEY_EXPIRES_AT";

const DEFAULT_SONIOX_MODEL = "stt-rt-v4";
const DEFAULT_SONIOX_ENDPOINT = "wss://stt-rt.soniox.com/transcribe-websocket";
const DEFAULT_SONIOX_LANGUAGES_CSV = "el,en";
const DEFAULT_ELEVENLABS_MODEL = "scribe_v2_realtime";
const DEFAULT_ELEVENLABS_ENDPOINT = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";
const DEFAULT_ELEVENLABS_LANGUAGES_CSV = "auto";
const DEFAULT_SAMPLE_RATE = 16000;
const SAMPLE_RATE_MIN = 8000;
const SAMPLE_RATE_MAX = 48000;
const ELEVENLABS_SAMPLE_RATES = new Set([8000, 16000, 22050, 24000, 44100, 48000]);
const DEFAULT_OUTPUT_MODE: OutputMode = "overwrite";
const DEFAULT_GUARD_PHRASE = "τέλος εντολής";
const DEFAULT_INTERACTION_MODE: InteractionMode = "dictation";
const DEFAULT_COMMAND_PHRASE = "command";
const DEFAULT_SECTION_END_PHRASE = "command send";
const DEFAULT_SECTION_CANCEL_PHRASE = "command cancel";
const DEFAULT_LITERAL_NEXT_PHRASE = "literal phrase";
const DEFAULT_TRANSLATION_POLICY: TranslationPolicy = "opposite";

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
  sttProvider?: string;
  elevenlabsApiKey?: string;
  elevenlabsApiKeyExpiresAt?: string;
  model?: string;
  endpoint?: string;
  language?: string[]; // commander variadic; undefined when not passed
  sampleRate?: string;
  endpointDetection?: boolean; // true/false when --endpoint-detection/--no-endpoint-detection was passed
  outputMode?: string;
  guardPhrase?: string;
  interactionMode?: string;
  commandPhrase?: string;
  sectionEndPhrase?: string;
  sectionCancelPhrase?: string;
  literalNextPhrase?: string;
  refineDefault?: string;
  translateDefault?: string;
  translationPolicy?: string;
  clipboardDefault?: string;
  inputDefault?: string;
  protocolOutput?: string;
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
      "Stream microphone audio to a realtime STT provider and print transcripts to stdout.",
    )
    .version(version, "-V, --version", "Print the untype version and exit.")
    .helpOption("-h, --help", "Show this help message and exit.")
    .addHelpText(
      "after",
      [
        "",
        "Configuration sources (highest priority first):",
        "  1. CLI flag",
        "  2. <cwd>/.env",
        "  3. ~/.tool-agents/untype/.env",
        "  4. shell environment",
        "",
        "Examples:",
        "  $ untype ui                              # open the macOS monitoring UI",
        "  $ untype --api-key sk_... --language el --language en",
        "  $ SONIOX_API_KEY=sk_... untype --output-mode append",
        "  $ untype --stt-provider elevenlabs --elevenlabs-api-key xi_...",
        "  $ untype --no-refine                       # disable LLM refinement",
        "  $ untype --language auto                   # let the STT provider auto-detect",
        "",
      ].join("\n"),
    )
    // STT provider transcription
    .option("--api-key <value>", "Soniox API key. Env: SONIOX_API_KEY.")
    .option(
      "--api-key-expires-at <YYYY-MM-DD>",
      "Reminder date for SONIOX_API_KEY renewal. Env: SONIOX_API_KEY_EXPIRES_AT.",
    )
    .option(
      "--stt-provider <name>",
      `Realtime transcription provider. One of: ${STT_PROVIDERS.join(", ")}. Env: UNTYPE_STT_PROVIDER.`,
    )
    .option(
      "--elevenlabs-api-key <value>",
      "ElevenLabs API key. Env: ELEVENLABS_API_KEY.",
    )
    .option(
      "--elevenlabs-api-key-expires-at <YYYY-MM-DD>",
      "Reminder date for ELEVENLABS_API_KEY renewal. Env: ELEVENLABS_API_KEY_EXPIRES_AT.",
    )
    .option(
      "--model <name>",
      "STT provider realtime model. Env: UNTYPE_MODEL.",
    )
    .option(
      "--endpoint <wss-url>",
      "STT provider WebSocket endpoint. Env: UNTYPE_ENDPOINT.",
    )
    .option(
      "--language <code>",
      "Language hint (ISO 639-1/2) or 'auto'. Repeat for multiple. Env: UNTYPE_LANGUAGES (comma-separated).",
      collectLanguage,
    )
    .option(
      "--sample-rate <hz>",
      "PCM sample rate (8000-48000). Env: UNTYPE_SAMPLE_RATE.",
    )
    .option(
      "--endpoint-detection",
      "Enable provider endpoint/VAD detection. Env: UNTYPE_ENABLE_ENDPOINT_DETECTION.",
    )
    .option(
      "--no-endpoint-detection",
      "Disable provider endpoint/VAD detection. Env: UNTYPE_ENABLE_ENDPOINT_DETECTION.",
    )
    // Rendering / turn detection
    .option(
      "--output-mode <mode>",
      `Stdout rendering mode. One of: ${OUTPUT_MODE_VALUES.join(", ")}. Env: UNTYPE_OUTPUT_MODE.`,
    )
    .option(
      "--guard-phrase <phrase>",
      "Phrase that closes the current turn. Env: UNTYPE_GUARD_PHRASE.",
    )
    // Voice-agent protocol
    .option(
      "--interaction-mode <mode>",
      `Interaction mode. One of: ${INTERACTION_MODES.join(", ")}. Env: UNTYPE_INTERACTION_MODE.`,
    )
    .option(
      "--command-phrase <phrase>",
      "Spoken marker for protocol state commands. Env: UNTYPE_COMMAND_PHRASE.",
    )
    .option(
      "--section-end-phrase <phrase>",
      "Spoken marker that submits the current section. Env: UNTYPE_SECTION_END_PHRASE.",
    )
    .option(
      "--section-cancel-phrase <phrase>",
      "Spoken marker that cancels the current section. Env: UNTYPE_SECTION_CANCEL_PHRASE.",
    )
    .option(
      "--literal-next-phrase <phrase>",
      "Spoken marker that treats the next marker as literal dictation. Env: UNTYPE_LITERAL_NEXT_PHRASE.",
    )
    .option(
      "--refine-default <on|off>",
      "Initial protocol refine operator state. Env: UNTYPE_REFINE_DEFAULT.",
    )
    .option(
      "--translate-default <on|off>",
      "Initial protocol translate operator state. Env: UNTYPE_TRANSLATE_DEFAULT.",
    )
    .option(
      "--translation-policy <policy>",
      `Protocol translation policy. One of: ${TRANSLATION_POLICIES.join(", ")}. Env: UNTYPE_TRANSLATION_POLICY.`,
    )
    .option(
      "--clipboard-default <on|off>",
      "Initial protocol clipboard operator state. Env: UNTYPE_CLIPBOARD_DEFAULT.",
    )
    .option(
      "--input-default <on|off>",
      "Initial protocol focused-input operator state. Env: UNTYPE_INPUT_DEFAULT.",
    )
    .option(
      "--protocol-output <path>",
      "JSONL protocol output path. Required for --interaction-mode hybrid. Env: UNTYPE_PROTOCOL_OUTPUT.",
    )
    // LLM refinement
    .option("--refine", "Enable LLM refinement (default: on). Env: UNTYPE_REFINE.")
    .option("--no-refine", "Disable LLM refinement.")
    .option(
      "--llm-provider <name>",
      `LLM provider. One of: ${LLM_PROVIDERS.join(", ")}. Env: UNTYPE_LLM_PROVIDER.`,
    )
    .option(
      "--llm-model <name>",
      "LLM model / deployment name (provider-specific). Env: UNTYPE_LLM_MODEL.",
    )
    // Diagnostics
    .option("-v, --verbose", "Emit diagnostic logs to stderr. Env: UNTYPE_VERBOSE.");

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

function validateInteractionMode(value: string): InteractionMode {
  if ((INTERACTION_MODES as readonly string[]).includes(value)) {
    return value as InteractionMode;
  }
  throw new InvalidConfigurationError(
    `--interaction-mode must be one of: ${INTERACTION_MODES.join(", ")}. Got: '${value}'.`,
  );
}

function validateTranslationPolicy(value: string): TranslationPolicy {
  if ((TRANSLATION_POLICIES as readonly string[]).includes(value)) {
    return value as TranslationPolicy;
  }
  throw new InvalidConfigurationError(
    `--translation-policy must be one of: ${TRANSLATION_POLICIES.join(", ")}. Got: '${value}'.`,
  );
}

function validateSttProvider(value: string): SttProvider {
  if ((STT_PROVIDERS as readonly string[]).includes(value)) {
    return value as SttProvider;
  }
  throw new InvalidConfigurationError(
    `--stt-provider must be one of: ${STT_PROVIDERS.join(", ")}. Got: '${value}'.`,
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

function validateProtocolPhrase(value: string, flagName: string): string {
  const v = value.trim();
  if (v.length === 0) {
    throw new InvalidConfigurationError(`${flagName} must not be empty.`);
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
        `Azure OpenAI is enabled (--refine on, --llm-provider=azure-openai) but the following env vars are not set in any of: CLI flag, ./.env, ~/.tool-agents/untype/.env, shell env — ${missing.join(", ")}. Set them or run with --no-refine to disable LLM refinement.`,
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
  if (provider === "google") {
    const apiKey = chain.value("GOOGLE_API_KEY");
    if (apiKey === undefined) {
      throw new LLMConfigurationError(
        "Google Gemini is enabled (--refine on, --llm-provider=google) but GOOGLE_API_KEY is not set in any of: CLI flag, ./.env, ~/.tool-agents/untype/.env, shell env. Set it or run with --no-refine to disable LLM refinement.",
      );
    }
    return {
      provider: "google",
      apiKey,
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
export function resolveConfig(
  argv: string[],
  opts: ResolveConfigOptions = {},
): ResolvedConfig {
  const version = readPackageVersion();
  const parsed = parseCli(argv, version);
  // Legacy-folder migration detection: if the new per-user config folder
  // ~/.tool-agents/untype/ is absent but the legacy folder
  // ~/.tool-agents/mic-tool-ts/ is present, error out with an explicit
  // migration hint. No silent fallback (per project no-fallback rule).
  const home = homedir();
  const newConfigDir = join(home, ".tool-agents", TOOL_NAME);
  const legacyConfigDir = join(home, ".tool-agents", "mic-tool-ts");
  if (!existsSync(newConfigDir) && existsSync(legacyConfigDir)) {
    throw new MissingConfigurationError(
      `Config folder not found at ~/.tool-agents/${TOOL_NAME}/. Detected legacy folder at ~/.tool-agents/mic-tool-ts/. Migrate with: mv ~/.tool-agents/mic-tool-ts ~/.tool-agents/${TOOL_NAME}`,
    );
  }
  const chain = loadEnvChain({ toolName: TOOL_NAME });
  const validateLlmProviderConfig = opts.validateLlmProviderConfig ?? true;

  // ---- STT provider + active provider API key (required) -----------------
  const sttProvider = validateSttProvider(
    resolveString(
      parsed.sttProvider,
      chain,
      "UNTYPE_STT_PROVIDER",
      "soniox",
    ),
  );

  let apiKey: string;
  let apiKeySource: "flag" | ".env" | "user" | "env";
  const apiKeyFlag = sttProvider === "soniox"
    ? parsed.apiKey
    : parsed.elevenlabsApiKey;
  const apiKeyEnvName = sttProvider === "soniox"
    ? SONIOX_ENV_KEY
    : ELEVENLABS_ENV_KEY;
  const apiKeyFlagName = sttProvider === "soniox"
    ? "--api-key"
    : "--elevenlabs-api-key";
  if (typeof apiKeyFlag === "string" && apiKeyFlag.trim().length > 0) {
    apiKey = apiKeyFlag.trim();
    apiKeySource = "flag";
  } else {
    const found = chain.get(apiKeyEnvName);
    if (found === null) {
      throw new MissingConfigurationError(
        `${apiKeyEnvName} is not set. Provide via ${apiKeyFlagName} flag, .env file (${apiKeyEnvName}=...), ~/.tool-agents/untype/.env, or shell environment variable.`,
      );
    }
    apiKey = found.value;
    apiKeySource = found.source;
  }

  // ---- Optional expiry reminder ------------------------------------------
  const expiryFlag = sttProvider === "soniox"
    ? parsed.apiKeyExpiresAt
    : parsed.elevenlabsApiKeyExpiresAt;
  const expiryFlagName = sttProvider === "soniox"
    ? "--api-key-expires-at"
    : "--elevenlabs-api-key-expires-at";
  const expiryEnvName = sttProvider === "soniox"
    ? SONIOX_EXPIRES_ENV
    : ELEVENLABS_EXPIRES_ENV;
  const apiKeyExpiresAtRaw = expiryFlag ?? chain.value(expiryEnvName);
  const apiKeyExpiresAt =
    apiKeyExpiresAtRaw === undefined
      ? undefined
      : parseIsoDate(
          apiKeyExpiresAtRaw,
          expiryFlagName,
          expiryEnvName,
        );

  // ---- Transcription parameters ------------------------------------------
  const defaultModel = sttProvider === "soniox"
    ? DEFAULT_SONIOX_MODEL
    : DEFAULT_ELEVENLABS_MODEL;
  const defaultEndpoint = sttProvider === "soniox"
    ? DEFAULT_SONIOX_ENDPOINT
    : DEFAULT_ELEVENLABS_ENDPOINT;
  const defaultLanguagesCsv = sttProvider === "soniox"
    ? DEFAULT_SONIOX_LANGUAGES_CSV
    : DEFAULT_ELEVENLABS_LANGUAGES_CSV;

  const model = resolveString(
    parsed.model,
    chain,
    "UNTYPE_MODEL",
    defaultModel,
  );
  const endpoint = parseWsUrl(
    resolveString(
      parsed.endpoint,
      chain,
      "UNTYPE_ENDPOINT",
      defaultEndpoint,
    ),
    "--endpoint",
    "UNTYPE_ENDPOINT",
  );

  // languages: array via flag (variadic), CSV via env var
  let languages: string[];
  if (parsed.language !== undefined && parsed.language.length > 0) {
    languages = parsed.language;
  } else {
    const fromEnv = chain.value("UNTYPE_LANGUAGES");
    languages = fromEnv !== undefined
      ? parseCsvNonEmpty(fromEnv, "--language", "UNTYPE_LANGUAGES")
      : parseCsvNonEmpty(
          defaultLanguagesCsv,
          "--language",
          "UNTYPE_LANGUAGES",
        );
  }
  languages = validateLanguages(languages);

  const sampleRate = parsePositiveInt(
    resolveString(
      parsed.sampleRate,
      chain,
      "UNTYPE_SAMPLE_RATE",
      String(DEFAULT_SAMPLE_RATE),
    ),
    "--sample-rate",
    "UNTYPE_SAMPLE_RATE",
    SAMPLE_RATE_MIN,
    SAMPLE_RATE_MAX,
  );
  if (sttProvider === "elevenlabs" && !ELEVENLABS_SAMPLE_RATES.has(sampleRate)) {
    throw new InvalidConfigurationError(
      `--sample-rate / UNTYPE_SAMPLE_RATE must be one of ${Array.from(ELEVENLABS_SAMPLE_RATES).join(", ")} when --stt-provider=elevenlabs. Got: ${sampleRate}.`,
    );
  }
  if (sttProvider === "elevenlabs" && languages.length > 1) {
    throw new InvalidConfigurationError(
      "--language may be 'auto' or a single language code when --stt-provider=elevenlabs.",
    );
  }

  let enableEndpointDetection: boolean;
  if (parsed.endpointDetection === true) {
    enableEndpointDetection = true;
  } else if (parsed.endpointDetection === false) {
    // commander sets `endpointDetection: false` when --no-endpoint-detection
    // was passed; absent when neither endpoint flag was passed.
    enableEndpointDetection = false;
  } else {
    const envVal = chain.value("UNTYPE_ENABLE_ENDPOINT_DETECTION");
    enableEndpointDetection =
      envVal === undefined
        ? true
        : parseBoolean(
            envVal,
            "--no-endpoint-detection",
            "UNTYPE_ENABLE_ENDPOINT_DETECTION",
          );
  }

  // ---- Rendering / turn detection ----------------------------------------
  const outputMode = validateOutputMode(
    resolveString(
      parsed.outputMode,
      chain,
      "UNTYPE_OUTPUT_MODE",
      DEFAULT_OUTPUT_MODE,
    ),
  );
  const guardPhrase = validateGuardPhrase(
    resolveString(
      parsed.guardPhrase,
      chain,
      "UNTYPE_GUARD_PHRASE",
      DEFAULT_GUARD_PHRASE,
    ),
  );

  // ---- Voice-agent protocol ---------------------------------------------
  const interactionMode = validateInteractionMode(
    resolveString(
      parsed.interactionMode,
      chain,
      "UNTYPE_INTERACTION_MODE",
      DEFAULT_INTERACTION_MODE,
    ),
  );
  const commandPhrase = validateProtocolPhrase(
    resolveString(
      parsed.commandPhrase,
      chain,
      "UNTYPE_COMMAND_PHRASE",
      DEFAULT_COMMAND_PHRASE,
    ),
    "--command-phrase",
  );
  const sectionEndPhrase = validateProtocolPhrase(
    resolveString(
      parsed.sectionEndPhrase,
      chain,
      "UNTYPE_SECTION_END_PHRASE",
      DEFAULT_SECTION_END_PHRASE,
    ),
    "--section-end-phrase",
  );
  const sectionCancelPhrase = validateProtocolPhrase(
    resolveString(
      parsed.sectionCancelPhrase,
      chain,
      "UNTYPE_SECTION_CANCEL_PHRASE",
      DEFAULT_SECTION_CANCEL_PHRASE,
    ),
    "--section-cancel-phrase",
  );
  const literalNextPhrase = validateProtocolPhrase(
    resolveString(
      parsed.literalNextPhrase,
      chain,
      "UNTYPE_LITERAL_NEXT_PHRASE",
      DEFAULT_LITERAL_NEXT_PHRASE,
    ),
    "--literal-next-phrase",
  );
  const refineDefault = parseBoolean(
    resolveString(
      parsed.refineDefault,
      chain,
      "UNTYPE_REFINE_DEFAULT",
      "off",
    ),
    "--refine-default",
    "UNTYPE_REFINE_DEFAULT",
  );
  const translateDefault = parseBoolean(
    resolveString(
      parsed.translateDefault,
      chain,
      "UNTYPE_TRANSLATE_DEFAULT",
      "off",
    ),
    "--translate-default",
    "UNTYPE_TRANSLATE_DEFAULT",
  );
  const clipboardDefault = parseBoolean(
    resolveString(
      parsed.clipboardDefault,
      chain,
      "UNTYPE_CLIPBOARD_DEFAULT",
      "off",
    ),
    "--clipboard-default",
    "UNTYPE_CLIPBOARD_DEFAULT",
  );
  const inputDefault = parseBoolean(
    resolveString(
      parsed.inputDefault,
      chain,
      "UNTYPE_INPUT_DEFAULT",
      "off",
    ),
    "--input-default",
    "UNTYPE_INPUT_DEFAULT",
  );
  const translationPolicy = validateTranslationPolicy(
    resolveString(
      parsed.translationPolicy,
      chain,
      "UNTYPE_TRANSLATION_POLICY",
      DEFAULT_TRANSLATION_POLICY,
    ),
  );
  const protocolOutputRaw =
    parsed.protocolOutput ?? chain.value("UNTYPE_PROTOCOL_OUTPUT");
  const protocolOutput =
    protocolOutputRaw === undefined || protocolOutputRaw.trim().length === 0
      ? undefined
      : protocolOutputRaw.trim();
  if (interactionMode === "hybrid" && protocolOutput === undefined) {
    throw new InvalidConfigurationError(
      "--protocol-output / UNTYPE_PROTOCOL_OUTPUT is required when --interaction-mode=hybrid.",
    );
  }
  const protocol: ProtocolRuntimeConfig = Object.freeze({
    interactionMode,
    markers: Object.freeze({
      commandPhrase,
      sectionEndPhrase,
      sectionEndAliases: Object.freeze([guardPhrase]),
      sectionCancelPhrase,
      literalNextPhrase,
    }),
    initialOperators: Object.freeze({
      refine: refineDefault,
      translate: translateDefault,
      clipboard: clipboardDefault,
      input: inputDefault,
    }),
    translationPolicy,
    protocolOutput,
    settingSources: Object.freeze({
      operators: Object.freeze({
        refine: protocolSettingSource(
          parsed.refineDefault,
          chain,
          "UNTYPE_REFINE_DEFAULT",
        ),
        translate: protocolSettingSource(
          parsed.translateDefault,
          chain,
          "UNTYPE_TRANSLATE_DEFAULT",
        ),
        clipboard: protocolSettingSource(
          parsed.clipboardDefault,
          chain,
          "UNTYPE_CLIPBOARD_DEFAULT",
        ),
        input: protocolSettingSource(
          parsed.inputDefault,
          chain,
          "UNTYPE_INPUT_DEFAULT",
        ),
      }),
      translationPolicy: protocolSettingSource(
        parsed.translationPolicy,
        chain,
        "UNTYPE_TRANSLATION_POLICY",
      ),
    }),
  });

  // ---- Verbose -----------------------------------------------------------
  let verbose: boolean;
  if (parsed.verbose === true) {
    verbose = true;
  } else {
    const v = chain.value("UNTYPE_VERBOSE");
    verbose = v === undefined ? false : parseBoolean(v, "--verbose", "UNTYPE_VERBOSE");
  }

  // ---- LLM refinement ----------------------------------------------------
  let llmEnabled: boolean;
  if (parsed.refine === true) {
    llmEnabled = true;
  } else if (parsed.refine === false) {
    llmEnabled = false;
  } else {
    const v = chain.value("UNTYPE_REFINE");
    llmEnabled = v === undefined ? true : parseBoolean(v, "--refine", "UNTYPE_REFINE");
  }
  const llmProvider = validateLLMProvider(
    resolveString(
      parsed.llmProvider,
      chain,
      "UNTYPE_LLM_PROVIDER",
      DEFAULT_LLM_PROVIDER,
    ),
  );
  const llmModel = resolveString(
    parsed.llmModel,
    chain,
    "UNTYPE_LLM_MODEL",
    DEFAULT_LLM_MODEL,
  ).trim();
  if (llmModel.length === 0) {
    throw new InvalidConfigurationError("--llm-model must not be empty.");
  }

  let providerConfig: ProviderConfig;
  if (llmEnabled && validateLlmProviderConfig) {
    providerConfig = resolveProviderConfig(llmProvider, llmModel, chain);
  } else if (llmProvider === "azure-openai") {
    providerConfig = {
      provider: "azure-openai",
      apiKey: "",
      endpoint: "",
      deployment: llmModel,
      apiVersion: DEFAULT_AZURE_API_VERSION,
    };
  } else if (llmProvider === "google") {
    providerConfig = {
      provider: "google",
      apiKey: "",
    };
  } else {
    providerConfig = { provider: llmProvider };
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
    process.stderr.write(
      `[untype] ${apiKeyEnvName} loaded from: ${apiKeySource}\n`,
    );
    process.stderr.write(`[untype] guard phrase: ${guardPhrase}\n`);
    process.stderr.write(
      `[untype] transcription: provider=${sttProvider}, model=${model}, endpoint=${endpoint}, languages=[${languages.join(", ")}], sample_rate=${sampleRate}, endpoint_detection=${enableEndpointDetection}\n`,
    );
    process.stderr.write(
      `[untype] protocol: mode=${interactionMode}, command=${commandPhrase}, send=${sectionEndPhrase}, cancel=${sectionCancelPhrase}, refine_default=${refineDefault}, translate_default=${translateDefault}, clipboard_default=${clipboardDefault}, input_default=${inputDefault}, translation_policy=${translationPolicy}\n`,
    );
    process.stderr.write(
      `[untype] llm: ${llmEnabled ? "enabled" : "disabled"} (provider=${llmProvider}, model=${llmModel})\n`,
    );
  }

  return Object.freeze<ResolvedConfig>({
    sttProvider,
    apiKey,
    apiKeyEnvName,
    apiKeySource,
    apiKeyExpiresAt,
    model,
    endpoint,
    languages,
    sampleRate,
    enableEndpointDetection,
    outputMode,
    guardPhrase,
    protocol,
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
  // — `untype --guard-phrase ""` is a user error, not a silent fallback.
  if (flagValue !== undefined) {
    return flagValue;
  }
  const fromChain = chain.value(envKey);
  if (fromChain !== undefined) return fromChain;
  return defaultValue;
}

function protocolSettingSource(
  flagValue: string | undefined,
  chain: EnvChain,
  envKey: string,
): ProtocolSettingSource {
  return flagValue !== undefined || chain.value(envKey) !== undefined
    ? "configured"
    : "default";
}
