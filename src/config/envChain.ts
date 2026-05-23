/**
 * Four-tier environment-variable resolution chain (per project conventions in
 * `~/.claude/CLAUDE.md` `<structure-and-conventions>` § tool-doc-config).
 *
 * Priority from highest to lowest:
 *   1. CLI flags                       (handled by the caller; not in scope here)
 *   2. <CWD>/.env                      (project-local)
 *   3. ~/.tool-agents/untype/.env    (per-user)
 *   4. process.env                     (shell)
 *
 * This module exposes a single function `loadEnvChain()` that returns a
 * snapshot of the resolved key→value map for the tool, plus a `sourceOf()`
 * helper used by `--verbose` logging.
 *
 * Design notes:
 * - We deliberately do NOT mutate `process.env`. Callers read from the
 *   returned map. This keeps tests isolated and makes precedence
 *   deterministic (Node's built-in `process.loadEnvFile()` would otherwise
 *   block tier 2/3 because it never overrides existing keys).
 * - Both `.env` files are optional. Missing files are not errors; malformed
 *   files raise `InvalidConfigurationError` so the user is never silently
 *   deprived of values they thought were loaded.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve as resolvePath, join } from "node:path";

import { InvalidConfigurationError } from "../errors.js";

export type EnvSource = "flag" | ".env" | "user" | "env";

export interface EnvChain {
  /**
   * Look up `key`. Returns the value AND which tier supplied it (excluding
   * the "flag" tier — flags are layered on top by the caller).
   *
   * Whitespace-only values are treated as missing.
   */
  get(key: string): { value: string; source: Exclude<EnvSource, "flag"> } | null;
  /** Convenience: returns just the value, or `undefined` when missing. */
  value(key: string): string | undefined;
}

interface DotenvMap {
  [key: string]: string;
}

// ----------------------------------------------------------------------------
// .env parsing — minimal but explicit. Kept in sync with the older parser in
// src/config.ts (which now delegates to this module).
// ----------------------------------------------------------------------------

function parseDotenv(contents: string): DotenvMap {
  const out: DotenvMap = {};
  for (const raw of contents.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const stripped = line.startsWith("export ")
      ? line.slice("export ".length)
      : line;
    const eqIdx = stripped.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = stripped.slice(0, eqIdx).trim();
    let value = stripped.slice(eqIdx + 1).trim();
    const isQuoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (isQuoted) {
      value = value.slice(1, -1);
    } else {
      const hashIdx = value.indexOf(" #");
      if (hashIdx >= 0) value = value.slice(0, hashIdx).trim();
    }
    if (key.length > 0) out[key] = value;
  }
  return out;
}

function readDotenvIfExists(path: string): DotenvMap | null {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw new InvalidConfigurationError(
      `Failed to read .env file at ${path}: ${(err as Error).message}`,
      { cause: err },
    );
  }
  try {
    return parseDotenv(contents);
  } catch (err) {
    throw new InvalidConfigurationError(
      `Failed to parse .env file at ${path}: ${(err as Error).message}`,
      { cause: err },
    );
  }
}

// ----------------------------------------------------------------------------
// Public loader
// ----------------------------------------------------------------------------

export interface LoadEnvChainOptions {
  /** CWD to look in for the project-local `.env`. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Home directory override (tests). Defaults to `os.homedir()`. */
  home?: string;
  /** Tool name segment under `~/.tool-agents/`. */
  toolName: string;
}

const TOOL_AGENTS_DIR = ".tool-agents";

export function loadEnvChain(opts: LoadEnvChainOptions): EnvChain {
  const cwd = opts.cwd ?? process.cwd();
  const home = opts.home ?? homedir();

  const localEnv = readDotenvIfExists(resolvePath(cwd, ".env"));
  const userEnv = readDotenvIfExists(
    join(home, TOOL_AGENTS_DIR, opts.toolName, ".env"),
  );
  const shellEnv = process.env;

  const get: EnvChain["get"] = (key) => {
    const local = localEnv?.[key];
    if (typeof local === "string" && local.trim().length > 0) {
      return { value: local.trim(), source: ".env" };
    }
    const user = userEnv?.[key];
    if (typeof user === "string" && user.trim().length > 0) {
      return { value: user.trim(), source: "user" };
    }
    const shell = shellEnv[key];
    if (typeof shell === "string" && shell.trim().length > 0) {
      return { value: shell.trim(), source: "env" };
    }
    return null;
  };

  const value: EnvChain["value"] = (key) => get(key)?.value;

  return { get, value };
}
