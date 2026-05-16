/**
 * Small typed coercion helpers used when reading values from the env-var
 * resolution chain. Each helper returns the parsed value or throws
 * `InvalidConfigurationError` with a message that names BOTH the flag and the
 * env-var alias so the user can fix whichever they set.
 */

import { InvalidConfigurationError } from "../errors.js";

const TRUTHY = new Set(["true", "yes", "on", "1"]);
const FALSY = new Set(["false", "no", "off", "0"]);

export function parseBoolean(
  raw: string,
  flagName: string,
  envName: string,
): boolean {
  const v = raw.trim().toLowerCase();
  if (TRUTHY.has(v)) return true;
  if (FALSY.has(v)) return false;
  throw new InvalidConfigurationError(
    `${flagName} / ${envName} must be one of: true, false, yes, no, on, off, 1, 0. Got: '${raw}'.`,
  );
}

export function parsePositiveInt(
  raw: string,
  flagName: string,
  envName: string,
  min?: number,
  max?: number,
): number {
  const v = raw.trim();
  if (!/^[0-9]+$/.test(v)) {
    throw new InvalidConfigurationError(
      `${flagName} / ${envName} must be a positive integer. Got: '${raw}'.`,
    );
  }
  const n = Number.parseInt(v, 10);
  if (min !== undefined && n < min) {
    throw new InvalidConfigurationError(
      `${flagName} / ${envName} must be >= ${min}. Got: ${n}.`,
    );
  }
  if (max !== undefined && n > max) {
    throw new InvalidConfigurationError(
      `${flagName} / ${envName} must be <= ${max}. Got: ${n}.`,
    );
  }
  return n;
}

export function parseCsvNonEmpty(
  raw: string,
  flagName: string,
  envName: string,
): string[] {
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (items.length === 0) {
    throw new InvalidConfigurationError(
      `${flagName} / ${envName} must contain at least one non-empty value.`,
    );
  }
  return items;
}

/**
 * Validate a YYYY-MM-DD date string and return it as-is. Throws on malformed
 * input. Does NOT compare against the current clock — that's the expiry
 * checker's job.
 */
export function parseIsoDate(
  raw: string,
  flagName: string,
  envName: string,
): string {
  const v = raw.trim();
  // Stricter than `new Date(v)` would be: require 10 chars and a valid date
  // round-trip.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new InvalidConfigurationError(
      `${flagName} / ${envName} must be YYYY-MM-DD. Got: '${raw}'.`,
    );
  }
  const ms = Date.parse(`${v}T00:00:00Z`);
  if (Number.isNaN(ms)) {
    throw new InvalidConfigurationError(
      `${flagName} / ${envName} is not a valid calendar date. Got: '${raw}'.`,
    );
  }
  // Round-trip the date so e.g. "2026-02-30" is rejected even though Date.parse
  // tolerates it.
  const d = new Date(ms);
  const round = `${d.getUTCFullYear().toString().padStart(4, "0")}-${(
    d.getUTCMonth() + 1
  )
    .toString()
    .padStart(2, "0")}-${d.getUTCDate().toString().padStart(2, "0")}`;
  if (round !== v) {
    throw new InvalidConfigurationError(
      `${flagName} / ${envName} is not a valid calendar date. Got: '${raw}'.`,
    );
  }
  return v;
}

/** Validate that `url` is `wss://` or `ws://`. Returns the trimmed URL. */
export function parseWsUrl(
  raw: string,
  flagName: string,
  envName: string,
): string {
  const v = raw.trim();
  if (!/^wss?:\/\/[^\s]+$/i.test(v)) {
    throw new InvalidConfigurationError(
      `${flagName} / ${envName} must be a wss:// or ws:// URL. Got: '${raw}'.`,
    );
  }
  return v;
}
