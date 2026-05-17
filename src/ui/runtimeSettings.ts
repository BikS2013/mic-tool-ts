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

const TOOL_NAME = "mic-tool-ts";
const BASE_ARGV = ["node", TOOL_NAME] as const;

export function loadRendererSettingsForUi(
  current: RendererSettings = DEFAULT_RENDERER_SETTINGS,
): UiSettingsLoadResult {
  try {
    const config = resolveConfig([...BASE_ARGV]);
    return {
      ok: true,
      settings: settingsFromResolvedConfig(config),
    };
  } catch (strictError) {
    try {
      const inspectionConfig = resolveConfig([...BASE_ARGV], {
        validateLlmProviderConfig: false,
      });
      return {
        ok: false,
        settings: settingsFromResolvedConfig(inspectionConfig),
        error: summarizeSettingsError(strictError),
      };
    } catch {
      return {
        ok: false,
        settings: refreshCredentialStatus(current),
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

function settingsFromResolvedConfig(config: ResolvedConfig): RendererSettings {
  const protocol = loadRuntimeProtocol(config);
  const summary: SafeConfigSummary = {
    ...safeConfigSummary(config),
    interactionMode: protocol.interactionMode,
    operators: protocol.initialOperators,
    translationPolicy: protocol.translationPolicy,
  };
  return settingsFromConfig(summary);
}

function loadRuntimeProtocol(config: ResolvedConfig): ProtocolRuntimeConfig {
  const persisted = loadPersistedProtocolSettings({ toolName: TOOL_NAME });
  return applyPersistedProtocolSettings(config.protocol, persisted);
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
