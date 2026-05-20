import type { SafeConfigSummary, SessionEvent } from "../core/sessionEvents.js";
import { LLM_PROVIDERS, type LLMProvider } from "../llm/types.js";
import { normalizeHotkeyAccelerator } from "./hotkey.js";

export interface RendererSettings {
  provider: string;
  model: string;
  languages: string[];
  sampleRate: number;
  endpointDetection: boolean;
  protocolMode: string;
  refine: boolean;
  translate: boolean;
  clipboard: boolean;
  focusedInput: boolean;
  translationPolicy: string;
  llmEnabled: boolean;
  llmProvider: string;
  llmModel: string;
  apiKeyName: string;
  apiKeyStatus: string;
  expiryStatus: string;
  storageStatus: string;
  inputStatus: string;
  hotkeyEnabled: boolean;
  hotkey: string;
}

export interface UiSettingsError {
  readonly code: string;
  readonly message: string;
  readonly exitCode: number;
}

export interface UiSettingsLoadResult {
  readonly ok: boolean;
  readonly settings: RendererSettings;
  readonly error?: UiSettingsError;
}

export interface MicToolTsPreloadApi {
  loadSettings(): Promise<UiSettingsLoadResult>;
  updateSettings(settings: Partial<RendererSettings>): Promise<RendererSettings>;
  startSession(): Promise<void>;
  stopSession(options?: StopSessionOptions): Promise<void>;
  onSessionEvent(callback: (event: SessionEvent) => void): () => void;
}

export interface StopSessionOptions {
  readonly submitPending?: boolean;
}

export const DEFAULT_RENDERER_SETTINGS: RendererSettings = Object.freeze({
  provider: "soniox",
  model: "stt-rt-v4",
  languages: ["el", "en"],
  sampleRate: 16000,
  endpointDetection: true,
  protocolMode: "dictation",
  refine: false,
  translate: false,
  clipboard: false,
  focusedInput: false,
  translationPolicy: "opposite",
  llmEnabled: true,
  llmProvider: "azure-openai",
  llmModel: "gpt-5.4",
  apiKeyName: "SONIOX_API_KEY",
  apiKeyStatus: "unknown",
  expiryStatus: "not set",
  storageStatus: "resolved config",
  inputStatus: "Off",
  hotkeyEnabled: false,
  hotkey: "Command+'",
});

export function settingsFromConfig(
  config: SafeConfigSummary,
  current: Pick<RendererSettings, "hotkeyEnabled" | "hotkey"> = DEFAULT_RENDERER_SETTINGS,
): RendererSettings {
  return {
    provider: config.sttProvider,
    model: config.model,
    languages: [...config.languages],
    sampleRate: config.sampleRate,
    endpointDetection: config.enableEndpointDetection,
    protocolMode: config.interactionMode,
    refine: config.operators.refine,
    translate: config.operators.translate,
    clipboard: config.operators.clipboard,
    focusedInput: config.operators.input,
    translationPolicy: config.translationPolicy,
    llmEnabled: config.llmEnabled,
    llmProvider: config.llmProvider,
    llmModel: config.llmModel,
    apiKeyName: config.apiKeyEnvName,
    apiKeyStatus: config.apiKeyConfigured ? "configured" : "missing",
    expiryStatus: config.apiKeyExpiresAt ?? "not set",
    storageStatus: sourceLabel(config.apiKeySource),
    inputStatus: config.operators.input ? "Ready" : "Off",
    hotkeyEnabled: current.hotkeyEnabled,
    hotkey: current.hotkey,
  };
}

export function mergeRendererSettings(
  current: RendererSettings,
  patch: Partial<RendererSettings>,
): RendererSettings {
  const next = {
    ...current,
    ...patch,
    languages: patch.languages === undefined
      ? [...current.languages]
      : normalizeLanguages(patch.languages),
  };
  return normalizeRendererSettings(next);
}

export function normalizeRendererSettings(value: RendererSettings): RendererSettings {
  const provider = normalizeProvider(value.provider);
  const focusedInput = Boolean(value.focusedInput);
  return {
    provider,
    model: normalizeNonEmptyString(value.model, "model"),
    languages: normalizeLanguages(value.languages),
    sampleRate: normalizeSampleRate(value.sampleRate),
    endpointDetection: Boolean(value.endpointDetection),
    protocolMode: normalizeProtocolMode(value.protocolMode),
    refine: Boolean(value.refine),
    translate: Boolean(value.translate),
    clipboard: Boolean(value.clipboard),
    focusedInput,
    translationPolicy: normalizeTranslationPolicy(value.translationPolicy),
    llmEnabled: Boolean(value.llmEnabled),
    llmProvider: normalizeLlmProvider(value.llmProvider),
    llmModel: normalizeNonEmptyString(value.llmModel, "llmModel"),
    apiKeyName: provider === "elevenlabs" ? "ELEVENLABS_API_KEY" : "SONIOX_API_KEY",
    apiKeyStatus: normalizeStatus(value.apiKeyStatus, "unknown"),
    expiryStatus: normalizeStatus(value.expiryStatus, "not set"),
    storageStatus: normalizeStatus(value.storageStatus, "resolved config"),
    inputStatus: focusedInput ? "Ready" : "Off",
    hotkeyEnabled: Boolean(value.hotkeyEnabled),
    hotkey: normalizeHotkeyAccelerator(value.hotkey),
  };
}

export function settingsToSessionArgs(settings: RendererSettings): string[] {
  const normalized = normalizeRendererSettings(settings);
  const args = [
    "--stt-provider",
    normalized.provider,
    "--model",
    normalized.model,
    "--sample-rate",
    String(normalized.sampleRate),
    normalized.endpointDetection ? "--endpoint-detection" : "--no-endpoint-detection",
    "--interaction-mode",
    normalized.protocolMode,
    "--refine-default",
    booleanFlag(normalized.refine),
    "--translate-default",
    booleanFlag(normalized.translate),
    "--clipboard-default",
    booleanFlag(normalized.clipboard),
    "--input-default",
    booleanFlag(normalized.focusedInput),
    "--translation-policy",
    normalized.translationPolicy,
    normalized.llmEnabled ? "--refine" : "--no-refine",
    "--llm-provider",
    normalized.llmProvider,
    "--llm-model",
    normalized.llmModel,
  ];
  for (const language of normalized.languages) {
    args.push("--language", language);
  }
  return args;
}

function normalizeProvider(value: string): "soniox" | "elevenlabs" {
  const normalized = value.trim().toLowerCase();
  if (normalized === "soniox" || normalized === "elevenlabs") return normalized;
  throw new Error(`Unsupported STT provider: ${value}`);
}

function normalizeProtocolMode(value: string): "dictation" | "agent-protocol" | "hybrid" {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "dictation" ||
    normalized === "agent-protocol" ||
    normalized === "hybrid"
  ) {
    return normalized;
  }
  throw new Error(`Unsupported protocol mode: ${value}`);
}

function normalizeTranslationPolicy(value: string): "opposite" | "to-en" | "to-el" {
  const normalized = value.trim().toLowerCase();
  if (normalized === "opposite" || normalized === "to-en" || normalized === "to-el") {
    return normalized;
  }
  throw new Error(`Unsupported translation policy: ${value}`);
}

function normalizeLlmProvider(value: string): LLMProvider {
  const normalized = value.trim().toLowerCase();
  if ((LLM_PROVIDERS as readonly string[]).includes(normalized)) {
    return normalized as LLMProvider;
  }
  throw new Error(`Unsupported LLM provider: ${value}`);
}

function normalizeNonEmptyString(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${field} must not be empty`);
  }
  return normalized;
}

function normalizeLanguages(values: readonly string[]): string[] {
  const normalized = values.map((value) => value.trim()).filter((value) => value.length > 0);
  if (normalized.length === 0) {
    throw new Error("At least one language hint is required");
  }
  return normalized;
}

function normalizeSampleRate(value: number): number {
  if (!Number.isInteger(value) || value < 8000 || value > 48000) {
    throw new Error(`sampleRate must be an integer between 8000 and 48000. Got: ${value}`);
  }
  return value;
}

function normalizeStatus(value: string, fallback: string): string {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}

function booleanFlag(value: boolean): "on" | "off" {
  return value ? "on" : "off";
}

function sourceLabel(source: SafeConfigSummary["apiKeySource"]): string {
  switch (source) {
    case "flag":
      return "CLI flag";
    case ".env":
      return "local .env";
    case "user":
      return "user .env";
    case "env":
      return "shell env";
  }
}
