import {
  resolveConfig,
  type ResolvedConfig,
} from "../config.js";
import { loadEnvChain, type EnvSource } from "../config/envChain.js";
import { MicToolError } from "../errors.js";
import {
  applyPersistedProtocolSettings,
  loadPersistedProtocolSettings,
} from "../protocol/settingsStore.js";
import type { ProtocolRuntimeConfig } from "../protocol/types.js";
import {
  safeConfigSummary,
  type SafeConfigSummary,
} from "../core/sessionEvents.js";
import {
  DEFAULT_RENDERER_SETTINGS,
  mergeRendererSettings,
  settingsFromConfig,
  type RendererSettings,
  type UiSettingsError,
  type UiSettingsLoadResult,
} from "./shared.js";
import {
  loadPersistedUiSettings,
  type PersistedUiSettings,
} from "./settingsStore.js";

const TOOL_NAME = "mic-tool-ts";
const BASE_ARGV = ["node", TOOL_NAME] as const;

export function loadRendererSettingsForUi(
  current: RendererSettings = DEFAULT_RENDERER_SETTINGS,
): UiSettingsLoadResult {
  let persistedUiSettings: Partial<PersistedUiSettings> | null;
  try {
    persistedUiSettings = loadPersistedUiSettings({ toolName: TOOL_NAME });
  } catch (err) {
    return {
      ok: false,
      settings: refreshCredentialStatus(current),
      error: summarizeSettingsError(err),
    };
  }
  try {
    const config = resolveConfig(argvForUiLoad(persistedUiSettings));
    return {
      ok: true,
      settings: settingsFromResolvedConfig(config, current, persistedUiSettings),
    };
  } catch (strictError) {
    try {
      const inspectionConfig = resolveConfig(argvForUiLoad(persistedUiSettings), {
        validateLlmProviderConfig: false,
      });
      return {
        ok: false,
        settings: settingsFromResolvedConfig(inspectionConfig, current, persistedUiSettings),
        error: summarizeSettingsError(strictError),
      };
    } catch {
      return {
        ok: false,
        settings: refreshCredentialStatus(applyPersistedUiSettings(current, persistedUiSettings)),
        error: summarizeSettingsError(strictError),
      };
    }
  }
}

export function refreshCredentialStatus(
  settings: RendererSettings,
): RendererSettings {
  const provider = settings.provider.trim().toLowerCase();
  const apiKeyName = provider === "elevenlabs"
    ? "ELEVENLABS_API_KEY"
    : "SONIOX_API_KEY";
  const expiryName = provider === "elevenlabs"
    ? "ELEVENLABS_API_KEY_EXPIRES_AT"
    : "SONIOX_API_KEY_EXPIRES_AT";
  const chain = loadEnvChain({ toolName: TOOL_NAME });
  const apiKey = chain.get(apiKeyName);
  const expiry = chain.value(expiryName);

  return mergeRendererSettings(settings, {
    apiKeyName,
    apiKeyStatus: apiKey === null ? "missing" : "configured",
    expiryStatus: expiry ?? "not set",
    storageStatus: apiKey === null ? "not found" : sourceLabel(apiKey.source),
  });
}

function settingsFromResolvedConfig(
  config: ResolvedConfig,
  current: Pick<RendererSettings, "hotkeyEnabled" | "hotkey">,
  persistedUiSettings: Partial<PersistedUiSettings> | null,
): RendererSettings {
  const protocol = loadRuntimeProtocol(config);
  const summary: SafeConfigSummary = {
    ...safeConfigSummary(config),
    interactionMode: protocol.interactionMode,
    operators: protocol.initialOperators,
    translationPolicy: protocol.translationPolicy,
  };
  return refreshCredentialStatus(
    applyPersistedUiSettings(settingsFromConfig(summary, current), persistedUiSettings),
  );
}

function loadRuntimeProtocol(config: ResolvedConfig): ProtocolRuntimeConfig {
  const persisted = loadPersistedProtocolSettings({ toolName: TOOL_NAME });
  return applyPersistedProtocolSettings(config.protocol, persisted);
}

function applyPersistedUiSettings(
  settings: RendererSettings,
  persistedUiSettings: Partial<PersistedUiSettings> | null,
): RendererSettings {
  if (persistedUiSettings === null) return settings;
  return mergeRendererSettings(settings, persistedUiSettings);
}

function argvForUiLoad(
  persistedUiSettings: Partial<PersistedUiSettings> | null,
): string[] {
  if (persistedUiSettings === null) return [...BASE_ARGV];
  return [...BASE_ARGV, ...argsFromPersistedUiSettings(persistedUiSettings)];
}

function argsFromPersistedUiSettings(
  settings: Partial<PersistedUiSettings>,
): string[] {
  const args: string[] = [];
  pushStringArg(args, "--stt-provider", settings.provider);
  pushStringArg(args, "--model", settings.model);
  if (settings.sampleRate !== undefined) {
    args.push("--sample-rate", String(settings.sampleRate));
  }
  if (settings.endpointDetection !== undefined) {
    args.push(settings.endpointDetection ? "--endpoint-detection" : "--no-endpoint-detection");
  }
  pushStringArg(args, "--interaction-mode", settings.protocolMode);
  pushBooleanSetting(args, "--refine-default", settings.refine);
  pushBooleanSetting(args, "--translate-default", settings.translate);
  pushBooleanSetting(args, "--clipboard-default", settings.clipboard);
  pushBooleanSetting(args, "--input-default", settings.focusedInput);
  pushStringArg(args, "--translation-policy", settings.translationPolicy);
  if (settings.llmEnabled !== undefined) {
    args.push(settings.llmEnabled ? "--refine" : "--no-refine");
  }
  pushStringArg(args, "--llm-provider", settings.llmProvider);
  pushStringArg(args, "--llm-model", settings.llmModel);
  for (const language of settings.languages ?? []) {
    args.push("--language", language);
  }
  return args;
}

function pushStringArg(args: string[], flag: string, value: string | undefined): void {
  if (value !== undefined) args.push(flag, value);
}

function pushBooleanSetting(args: string[], flag: string, value: boolean | undefined): void {
  if (value !== undefined) args.push(flag, value ? "on" : "off");
}

function summarizeSettingsError(error: unknown): UiSettingsError {
  if (error instanceof MicToolError) {
    return {
      code: error.code,
      message: error.message,
      exitCode: error.exitCode,
    };
  }
  if (error instanceof Error) {
    return {
      code: "UNKNOWN",
      message: error.message,
      exitCode: 1,
    };
  }
  return {
    code: "UNKNOWN",
    message: String(error),
    exitCode: 1,
  };
}

function sourceLabel(source: Exclude<EnvSource, "flag">): string {
  switch (source) {
    case ".env":
      return "local .env";
    case "user":
      return "user .env";
    case "env":
      return "shell env";
  }
}
