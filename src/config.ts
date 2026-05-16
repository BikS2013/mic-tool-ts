/**
 * Unit A — Configuration resolution.
 *
 * Responsibilities:
 *   1. Parse argv via commander (binary name: `mic-tool`).
 *   2. Resolve the Soniox API key through the precedence chain
 *      `--api-key` (CLI flag) > `.env` file in CWD > shell environment variable.
 *   3. Validate the resolved values and return a frozen {@link ResolvedConfig}.
 *
 * Approach notes:
 *   - The plan suggests `process.loadEnvFile()` (Node 20.12+). That builtin
 *     does NOT overwrite values already present in `process.env`, which means
 *     the natural precedence would be `shell-env > .env`. The FR-5 contract
 *     in `docs/design/refined-request-soniox-mic-transcriber.md` requires the
 *     opposite (`.env > shell-env`).
 *
 *     To obtain deterministic precedence without mutating `process.env` in
 *     surprising ways we parse the `.env` file ourselves (~15 lines of code).
 *     This also avoids the "did node load it or not?" ambiguity in tests.
 *
 *   - No fallback values for missing config: a missing API key raises
 *     {@link MissingConfigurationError}; bad flag values raise
 *     {@link InvalidConfigurationError}.
 *
 *   - `--help` / `--version` are handled by commander but we route them
 *     through `.exitOverride()` so that the orchestrator (Unit E), not
 *     commander, owns the call to `process.exit`. They surface here as
 *     {@link HelpOrVersionShown}, which `main.ts` should treat as exit 0.
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
  /** Soniox API key. Guaranteed non-empty after trim. */
  readonly apiKey: string;
  /** ISO 639-1/2 code (e.g. "en", "pt-BR") or the literal "auto". */
  readonly language: string;
  /** Stdout rendering mode. */
  readonly outputMode: OutputMode;
  /** When true, the CLI emits diagnostic messages to stderr. */
  readonly verbose: boolean;
  /** Guard phrase that closes the current turn when detected in recent
   *  finalized transcript. Non-empty after normalization. */
  readonly guardPhrase: string;
  /** LLM refinement configuration. When `enabled` is false the orchestrator
   *  skips refiner construction entirely. */
  readonly llm: LLMConfig;
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
// Internal constants
// ----------------------------------------------------------------------------

const OUTPUT_MODE_VALUES: readonly OutputMode[] = [
  "overwrite",
  "append",
  "final-only",
] as const;

// ISO 639-1 (2 letters) or 639-2 (3 letters), optionally region-suffixed
// (e.g. "en", "pt-BR"), or the literal "auto" handled separately.
const LANGUAGE_REGEX = /^[a-z]{2,3}(-[A-Z]{2})?$/;

const ENV_KEY = "SONIOX_API_KEY";

const DEFAULT_GUARD_PHRASE = "τέλος εντολής";

const TOOL_NAME = "mic-tool";

const DEFAULT_LLM_PROVIDER: LLMProvider = "azure-openai";
const DEFAULT_LLM_MODEL = "gpt-5.4";
const DEFAULT_LLM_REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_AZURE_API_VERSION = "2024-10-21";

const DEFAULT_SYSTEM_PROMPT =
  "You are a transcript-cleanup assistant. The input is a verbatim transcript of someone speaking and may contain disfluencies, filler words, false starts, and grammatical noise. Rewrite the text so it is grammatically correct and easy to read, preserving the speaker's meaning AND the original language. Respond with ONLY the cleaned text — no preamble, no quotes, no markdown, no explanation.";

// ----------------------------------------------------------------------------
// Version lookup (from package.json)
// ----------------------------------------------------------------------------

function readPackageVersion(): string {
  // `import ... with { type: "json" }` is fine under NodeNext, but
  // `createRequire` keeps the call ergonomic and works regardless of the
  // host's import-attributes support level.
  const requireFromHere = createRequire(import.meta.url);
  const pkg = requireFromHere("../package.json") as { version?: unknown };
  if (typeof pkg.version !== "string" || pkg.version.length === 0) {
    throw new Error("package.json is missing a 'version' field");
  }
  return pkg.version;
}

// Note: .env file parsing and the four-tier env-var resolution chain live in
// `./config/envChain.ts`. This module imports `loadEnvChain` and consults the
// resulting `EnvChain` whenever it needs a non-flag value.

// ----------------------------------------------------------------------------
// CLI parser
// ----------------------------------------------------------------------------

interface ParsedCliOptions {
  apiKey?: string;
  language: string;
  outputMode: string;
  verbose: boolean;
  guardPhrase: string;
  refine: boolean;
  llmProvider: string;
  llmModel: string;
}

function parseCli(argv: string[], version: string): ParsedCliOptions {
  const program = new Command();
  program
    .name("mic-tool")
    .description(
      "Stream microphone audio to the Soniox real-time STT API and print transcripts to stdout.",
    )
    .version(version, "-V, --version", "Print the mic-tool version and exit.")
    .helpOption("-h, --help", "Show this help message and exit.")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  $ mic-tool --api-key sk_... --language en",
        "  $ SONIOX_API_KEY=sk_... mic-tool --output-mode append",
        "",
      ].join("\n"),
    )
    .option("--api-key <value>", "Soniox API key (overrides .env and shell env).")
    .option(
      "--language <code>",
      "ISO 639-1 code (e.g. 'en', 'es', 'pt-BR') or 'auto'.",
      "en",
    )
    .option(
      "--output-mode <mode>",
      `Stdout rendering mode. One of: ${OUTPUT_MODE_VALUES.join(", ")}.`,
      "overwrite",
    )
    .option(
      "--guard-phrase <phrase>",
      "Phrase that closes the current turn when heard. A blank line is emitted on detection.",
      DEFAULT_GUARD_PHRASE,
    )
    .option(
      "--refine",
      "Send each closed turn to an LLM for grammar/clarity refinement (default: on).",
    )
    .option(
      "--no-refine",
      "Disable LLM refinement of closed turns.",
    )
    .option(
      "--llm-provider <name>",
      `LLM provider for refinement. One of: ${LLM_PROVIDERS.join(", ")}.`,
      DEFAULT_LLM_PROVIDER,
    )
    .option(
      "--llm-model <name>",
      "Model / deployment name to use (provider-specific).",
      DEFAULT_LLM_MODEL,
    )
    .option("-v, --verbose", "Emit diagnostic logs to stderr.", false);

  // Take ownership of help/version/error exits so the orchestrator owns
  // process.exit().
  program.exitOverride();
  program.configureOutput({
    // Send commander's own error text to stderr; help/version still go to
    // stdout via commander's default writer.
    writeErr: (str) => process.stderr.write(str),
  });

  try {
    program.parse(argv);
  } catch (err) {
    if (err instanceof CommanderError) {
      // commander's exit codes:
      //   - "commander.helpDisplayed" / "commander.help" / "commander.version" → exit 0 informational
      //   - "commander.invalidArgument" / "commander.unknownOption" / etc. → user error
      if (
        err.code === "commander.helpDisplayed" ||
        err.code === "commander.help"
      ) {
        throw new HelpOrVersionShown("help");
      }
      if (err.code === "commander.version") {
        throw new HelpOrVersionShown("version");
      }
      // Any other commander error (bad choice, unknown option, missing
      // argument value) is a configuration problem from the user.
      throw new InvalidConfigurationError(err.message, { cause: err });
    }
    throw err;
  }

  const opts = program.opts<{
    apiKey?: string;
    language: string;
    outputMode: string;
    verbose: boolean;
    guardPhrase: string;
    refine?: boolean;
    llmProvider: string;
    llmModel: string;
  }>();

  // Commander gives `refine: undefined` when neither --refine nor --no-refine
  // was passed, `false` for --no-refine, `true` for --refine. Default to on.
  const refine = opts.refine === false ? false : true;

  return {
    apiKey: opts.apiKey,
    language: opts.language,
    outputMode: opts.outputMode,
    verbose: Boolean(opts.verbose),
    guardPhrase: opts.guardPhrase,
    refine,
    llmProvider: opts.llmProvider,
    llmModel: opts.llmModel,
  };
}

// ----------------------------------------------------------------------------
// Validation
// ----------------------------------------------------------------------------

function validateLanguage(value: string): string {
  const v = value.trim();
  if (v === "auto") return "auto";
  if (LANGUAGE_REGEX.test(v)) return v;
  throw new InvalidConfigurationError(
    `--language must be 'auto' or an ISO 639-1/2 code (e.g. 'en', 'es', 'pt-BR'). Got: '${value}'.`,
  );
}

function validateOutputMode(value: string): OutputMode {
  if ((OUTPUT_MODE_VALUES as readonly string[]).includes(value)) {
    return value as OutputMode;
  }
  throw new InvalidConfigurationError(
    `--output-mode must be one of: ${OUTPUT_MODE_VALUES.join(", ")}. Got: '${value}'.`,
  );
}

/**
 * Normalize a phrase for guard-phrase matching:
 *   - NFD-decompose, strip combining marks (so 'τέλος' matches 'τελος')
 *   - lowercase
 *   - collapse any non-letter/non-digit run to a single space
 *   - trim
 *
 * Kept in sync with the same function in `src/turn/detector.ts`.
 */
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
    throw new InvalidConfigurationError(
      "--guard-phrase must not be empty.",
    );
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

/**
 * Resolve provider-specific env vars per the four-tier chain and assemble a
 * `ProviderConfig` for the chosen provider. Throws {@link LLMConfigurationError}
 * when the provider is enabled but its required env vars are missing.
 */
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

  // The other seven providers are recognised by the validator but not yet
  // implemented. The factory will throw a more pointed error at refiner
  // construction; we surface the same intent here so misconfiguration is
  // visible at startup.
  return { provider };
}

// ----------------------------------------------------------------------------
// Public entry point
// ----------------------------------------------------------------------------

type ApiKeySource = "flag" | ".env" | "user" | "env";

/**
 * Resolve CLI args + .env + shell env into a frozen {@link ResolvedConfig}.
 *
 * @throws {HelpOrVersionShown}        on `--help` or `--version`.
 * @throws {MissingConfigurationError} when no API key is found in any source.
 * @throws {InvalidConfigurationError} on invalid flag values or unreadable `.env`.
 */
export function resolveConfig(argv: string[]): ResolvedConfig {
  const version = readPackageVersion();
  const parsed = parseCli(argv, version);

  // Four-tier env-var chain (highest priority first): CLI flag, ./.env,
  // ~/.tool-agents/mic-tool/.env, shell env.
  const chain = loadEnvChain({ toolName: TOOL_NAME });

  // ---- Soniox API key -----------------------------------------------------
  const flagKey = parsed.apiKey;
  let apiKey: string | undefined;
  let source: ApiKeySource | undefined;

  if (typeof flagKey === "string" && flagKey.trim().length > 0) {
    apiKey = flagKey.trim();
    source = "flag";
  } else {
    const found = chain.get(ENV_KEY);
    if (found !== null) {
      apiKey = found.value;
      source = found.source;
    }
  }

  if (apiKey === undefined || source === undefined) {
    throw new MissingConfigurationError(
      "SONIOX_API_KEY is not set. Provide via --api-key flag, .env file (SONIOX_API_KEY=...), ~/.tool-agents/mic-tool/.env, or shell environment variable.",
    );
  }

  const language = validateLanguage(parsed.language);
  const outputMode = validateOutputMode(parsed.outputMode);
  const guardPhrase = validateGuardPhrase(parsed.guardPhrase);
  const verbose = parsed.verbose;

  // ---- LLM refinement config ---------------------------------------------
  const llmProvider = validateLLMProvider(parsed.llmProvider);
  const llmModel = parsed.llmModel.trim();
  if (llmModel.length === 0) {
    throw new InvalidConfigurationError("--llm-model must not be empty.");
  }
  const llmEnabled = parsed.refine;
  let providerConfig: ProviderConfig;
  if (llmEnabled) {
    providerConfig = resolveProviderConfig(llmProvider, llmModel, chain);
  } else {
    // When disabled we still record the requested provider so verbose logs
    // show what would have been used, but we do not validate env vars.
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
    process.stderr.write(`[mic-tool] api key loaded from: ${source}\n`);
    process.stderr.write(`[mic-tool] guard phrase: ${guardPhrase}\n`);
    process.stderr.write(
      `[mic-tool] llm: ${llmEnabled ? "enabled" : "disabled"} (provider=${llmProvider}, model=${llmModel})\n`,
    );
  }

  return Object.freeze<ResolvedConfig>({
    apiKey,
    language,
    outputMode,
    verbose,
    guardPhrase,
    llm,
  });
}
