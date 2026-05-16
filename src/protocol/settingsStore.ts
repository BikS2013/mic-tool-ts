import {
  chmodSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { InvalidConfigurationError } from "../errors.js";
import type {
  OperatorState,
  ProtocolRuntimeConfig,
  ProtocolSettingsSnapshot,
  TranslationPolicy,
} from "./types.js";
import { TRANSLATION_POLICIES } from "./types.js";

const TOOL_AGENTS_DIR = ".tool-agents";
const STATE_FILE_NAME = "state.json";
const STATE_VERSION = 1;

interface PersistedStateFile {
  version: 1;
  saved_at: string;
  protocol: ProtocolSettingsSnapshot;
}

export interface ProtocolSettingsStoreOptions {
  toolName: string;
  home?: string;
}

export function protocolSettingsPath(opts: ProtocolSettingsStoreOptions): string {
  return join(
    opts.home ?? homedir(),
    TOOL_AGENTS_DIR,
    opts.toolName,
    STATE_FILE_NAME,
  );
}

export function loadPersistedProtocolSettings(
  opts: ProtocolSettingsStoreOptions,
): ProtocolSettingsSnapshot | null {
  const path = protocolSettingsPath(opts);
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw new InvalidConfigurationError(
      `Failed to read protocol settings state at ${path}: ${(err as Error).message}`,
      { cause: err },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (err) {
    throw new InvalidConfigurationError(
      `Failed to parse protocol settings state at ${path}: ${(err as Error).message}`,
      { cause: err },
    );
  }

  return validateStateFile(parsed, path).protocol;
}

export function savePersistedProtocolSettings(
  settings: ProtocolSettingsSnapshot,
  opts: ProtocolSettingsStoreOptions,
): void {
  const path = protocolSettingsPath(opts);
  const dir = join(opts.home ?? homedir(), TOOL_AGENTS_DIR, opts.toolName);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);

  const file: PersistedStateFile = {
    version: STATE_VERSION,
    saved_at: new Date().toISOString(),
    protocol: {
      operators: { ...settings.operators },
      translation_policy: settings.translation_policy,
    },
  };
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(path, 0o600);
}

export function applyPersistedProtocolSettings(
  protocol: ProtocolRuntimeConfig,
  persisted: ProtocolSettingsSnapshot | null,
): ProtocolRuntimeConfig {
  if (persisted === null) return protocol;

  const operators: OperatorState = {
    refine:
      protocol.settingSources.operators.refine === "default"
        ? persisted.operators.refine
        : protocol.initialOperators.refine,
    translate:
      protocol.settingSources.operators.translate === "default"
        ? persisted.operators.translate
        : protocol.initialOperators.translate,
    clipboard:
      protocol.settingSources.operators.clipboard === "default"
        ? persisted.operators.clipboard
        : protocol.initialOperators.clipboard,
  };

  const translationPolicy =
    protocol.settingSources.translationPolicy === "default"
      ? persisted.translation_policy
      : protocol.translationPolicy;

  return Object.freeze({
    ...protocol,
    initialOperators: Object.freeze(operators),
    translationPolicy,
  });
}

function validateStateFile(value: unknown, path: string): PersistedStateFile {
  if (!isRecord(value)) {
    throw invalidState(path, "root value must be an object");
  }
  if (value.version !== STATE_VERSION) {
    throw invalidState(path, `version must be ${STATE_VERSION}`);
  }
  if (typeof value.saved_at !== "string" || value.saved_at.trim().length === 0) {
    throw invalidState(path, "saved_at must be a non-empty string");
  }
  if (!isRecord(value.protocol)) {
    throw invalidState(path, "protocol must be an object");
  }
  const protocol = value.protocol;
  if (!isRecord(protocol.operators)) {
    throw invalidState(path, "protocol.operators must be an object");
  }
  const operators = protocol.operators;
  for (const key of ["refine", "translate", "clipboard"] as const) {
    if (typeof operators[key] !== "boolean") {
      throw invalidState(path, `protocol.operators.${key} must be a boolean`);
    }
  }
  if (
    typeof protocol.translation_policy !== "string" ||
    !(TRANSLATION_POLICIES as readonly string[]).includes(
      protocol.translation_policy,
    )
  ) {
    throw invalidState(
      path,
      `protocol.translation_policy must be one of: ${TRANSLATION_POLICIES.join(", ")}`,
    );
  }

  return {
    version: STATE_VERSION,
    saved_at: value.saved_at,
    protocol: {
      operators: {
        refine: operators.refine as boolean,
        translate: operators.translate as boolean,
        clipboard: operators.clipboard as boolean,
      },
      translation_policy: protocol.translation_policy as TranslationPolicy,
    },
  };
}

function invalidState(path: string, message: string): InvalidConfigurationError {
  return new InvalidConfigurationError(
    `Invalid protocol settings state at ${path}: ${message}. Delete or fix ${path}.`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
