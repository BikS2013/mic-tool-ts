import {
  chmodSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { InvalidConfigurationError } from "../errors.js";
import {
  DEFAULT_RENDERER_SETTINGS,
  mergeRendererSettings,
  type RendererSettings,
} from "./shared.js";

const TOOL_AGENTS_DIR = ".tool-agents";
const UI_STATE_FILE_NAME = "ui-state.json";
const STATE_VERSION = 1;

export interface PersistedPushToTalkSettings {
  readonly enabled: boolean;
  readonly hotkey: string;
}

export type PersistedUiSettings = Pick<
  RendererSettings,
  | "provider"
  | "model"
  | "languages"
  | "sampleRate"
  | "endpointDetection"
  | "protocolMode"
  | "refine"
  | "translate"
  | "clipboard"
  | "focusedInput"
  | "translationPolicy"
  | "llmEnabled"
  | "hotkeyEnabled"
  | "hotkey"
>;

interface PersistedUiStateFile {
  version: 1;
  saved_at: string;
  settings?: Partial<PersistedUiSettings>;
  push_to_talk?: PersistedPushToTalkSettings;
}

export interface UiSettingsStoreOptions {
  readonly toolName: string;
  readonly home?: string;
}

export function uiSettingsPath(opts: UiSettingsStoreOptions): string {
  return join(
    opts.home ?? homedir(),
    TOOL_AGENTS_DIR,
    opts.toolName,
    UI_STATE_FILE_NAME,
  );
}

export function loadPersistedPushToTalkSettings(
  opts: UiSettingsStoreOptions,
): PersistedPushToTalkSettings | null {
  const settings = loadPersistedUiSettings(opts);
  if (settings === null) return null;
  return {
    enabled: settings.hotkeyEnabled ?? DEFAULT_RENDERER_SETTINGS.hotkeyEnabled,
    hotkey: settings.hotkey ?? DEFAULT_RENDERER_SETTINGS.hotkey,
  };
}

export function loadPersistedUiSettings(
  opts: UiSettingsStoreOptions,
): Partial<PersistedUiSettings> | null {
  const path = uiSettingsPath(opts);
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw new InvalidConfigurationError(
      `Failed to read UI settings state at ${path}: ${(err as Error).message}`,
      { cause: err },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (err) {
    throw new InvalidConfigurationError(
      `Failed to parse UI settings state at ${path}: ${(err as Error).message}`,
      { cause: err },
    );
  }

  return validateStateFile(parsed, path).settings ?? null;
}

export function savePersistedPushToTalkSettings(
  settings: PersistedPushToTalkSettings,
  opts: UiSettingsStoreOptions,
): void {
  savePersistedUiSettings(
    {
      ...persistedFromRenderer(DEFAULT_RENDERER_SETTINGS),
      hotkeyEnabled: settings.enabled,
      hotkey: settings.hotkey,
    },
    opts,
  );
}

export function savePersistedUiSettings(
  settings: PersistedUiSettings | RendererSettings,
  opts: UiSettingsStoreOptions,
): void {
  const path = uiSettingsPath(opts);
  const dir = join(opts.home ?? homedir(), TOOL_AGENTS_DIR, opts.toolName);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);

  const persisted = normalizePersistedUiSettings(settings);
  const file: PersistedUiStateFile = {
    version: STATE_VERSION,
    saved_at: new Date().toISOString(),
    settings: persisted,
    push_to_talk: {
      enabled: persisted.hotkeyEnabled,
      hotkey: persisted.hotkey,
    },
  };
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(path, 0o600);
}

export function persistedFromRenderer(settings: RendererSettings): PersistedUiSettings {
  return {
    provider: settings.provider,
    model: settings.model,
    languages: [...settings.languages],
    sampleRate: settings.sampleRate,
    endpointDetection: settings.endpointDetection,
    protocolMode: settings.protocolMode,
    refine: settings.refine,
    translate: settings.translate,
    clipboard: settings.clipboard,
    focusedInput: settings.focusedInput,
    translationPolicy: settings.translationPolicy,
    llmEnabled: settings.llmEnabled,
    hotkeyEnabled: settings.hotkeyEnabled,
    hotkey: settings.hotkey,
  };
}

function validateStateFile(value: unknown, path: string): PersistedUiStateFile {
  if (!isRecord(value)) {
    throw invalidState(path, "root value must be an object");
  }
  if (value.version !== STATE_VERSION) {
    throw invalidState(path, `version must be ${STATE_VERSION}`);
  }
  if (typeof value.saved_at !== "string" || value.saved_at.trim().length === 0) {
    throw invalidState(path, "saved_at must be a non-empty string");
  }
  if (value.settings !== undefined && !isRecord(value.settings)) {
    throw invalidState(path, "settings must be an object");
  }
  if (value.push_to_talk !== undefined && !isRecord(value.push_to_talk)) {
    throw invalidState(path, "push_to_talk must be an object");
  }
  if (value.settings === undefined && value.push_to_talk === undefined) {
    throw invalidState(path, "settings or push_to_talk must be present");
  }

  const settings = value.settings === undefined
    ? undefined
    : validatePersistedUiSettings(value.settings, path);
  const pushToTalk = value.push_to_talk === undefined
    ? undefined
    : validatePushToTalkSettings(value.push_to_talk, path);

  return {
    version: STATE_VERSION,
    saved_at: value.saved_at,
    settings: settings ?? (
      pushToTalk === undefined
        ? undefined
        : {
            hotkeyEnabled: pushToTalk.enabled,
            hotkey: pushToTalk.hotkey,
          }
    ),
    push_to_talk: pushToTalk,
  };
}

function validatePushToTalkSettings(
  value: Record<string, unknown>,
  path: string,
): PersistedPushToTalkSettings {
  if (typeof value.enabled !== "boolean") {
    throw invalidState(path, "push_to_talk.enabled must be a boolean");
  }
  if (typeof value.hotkey !== "string") {
    throw invalidState(path, "push_to_talk.hotkey must be a string");
  }

  try {
    const normalized = mergeRendererSettings(DEFAULT_RENDERER_SETTINGS, {
      hotkeyEnabled: value.enabled,
      hotkey: value.hotkey,
    });
    return {
      enabled: normalized.hotkeyEnabled,
      hotkey: normalized.hotkey,
    };
  } catch (err) {
    throw invalidState(
      path,
      `push_to_talk.hotkey is invalid: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function validatePersistedUiSettings(
  value: Record<string, unknown>,
  path: string,
): PersistedUiSettings {
  const required = [
    "provider",
    "model",
    "languages",
    "sampleRate",
    "endpointDetection",
    "protocolMode",
    "refine",
    "translate",
    "clipboard",
    "focusedInput",
    "translationPolicy",
    "llmEnabled",
    "hotkeyEnabled",
    "hotkey",
  ] as const;

  for (const key of required) {
    if (value[key] === undefined) {
      throw invalidState(path, `settings.${key} is required`);
    }
  }

  return normalizePersistedUiSettings({
    provider: requireString(value.provider, path, "settings.provider"),
    model: requireString(value.model, path, "settings.model"),
    languages: requireStringArray(value.languages, path, "settings.languages"),
    sampleRate: requireNumber(value.sampleRate, path, "settings.sampleRate"),
    endpointDetection: requireBoolean(value.endpointDetection, path, "settings.endpointDetection"),
    protocolMode: requireString(value.protocolMode, path, "settings.protocolMode"),
    refine: requireBoolean(value.refine, path, "settings.refine"),
    translate: requireBoolean(value.translate, path, "settings.translate"),
    clipboard: requireBoolean(value.clipboard, path, "settings.clipboard"),
    focusedInput: requireBoolean(value.focusedInput, path, "settings.focusedInput"),
    translationPolicy: requireString(value.translationPolicy, path, "settings.translationPolicy"),
    llmEnabled: requireBoolean(value.llmEnabled, path, "settings.llmEnabled"),
    hotkeyEnabled: requireBoolean(value.hotkeyEnabled, path, "settings.hotkeyEnabled"),
    hotkey: requireString(value.hotkey, path, "settings.hotkey"),
  }, path);
}

function normalizePersistedUiSettings(
  settings: PersistedUiSettings | RendererSettings,
  path?: string,
): PersistedUiSettings {
  try {
    return persistedFromRenderer(
      mergeRendererSettings(DEFAULT_RENDERER_SETTINGS, settings),
    );
  } catch (err) {
    if (path !== undefined) {
      throw invalidState(path, err instanceof Error ? err.message : String(err));
    }
    throw err;
  }
}

function requireString(value: unknown, path: string, field: string): string {
  if (typeof value !== "string") {
    throw invalidState(path, `${field} must be a string`);
  }
  return value;
}

function requireNumber(value: unknown, path: string, field: string): number {
  if (typeof value !== "number") {
    throw invalidState(path, `${field} must be a number`);
  }
  return value;
}

function requireBoolean(value: unknown, path: string, field: string): boolean {
  if (typeof value !== "boolean") {
    throw invalidState(path, `${field} must be a boolean`);
  }
  return value;
}

function requireStringArray(value: unknown, path: string, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw invalidState(path, `${field} must be an array of strings`);
  }
  return value;
}

function invalidState(path: string, message: string): InvalidConfigurationError {
  return new InvalidConfigurationError(
    `Invalid UI settings state at ${path}: ${message}. Delete or fix ${path}.`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
