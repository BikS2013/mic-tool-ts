/**
 * Operational expiry tracking for the Soniox API key (and, in future, other
 * keys). Per CLAUDE.md `<configuration-guide>`, expiring credentials should
 * have an associated YYYY-MM-DD reminder so the tool can warn proactively.
 *
 * The tool does NOT block on expiry — the user owns renewal. We only emit a
 * single stderr warning at startup.
 */

const WARNING_WINDOW_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ExpiryLevel = "ok" | "soon" | "expired";

export interface ExpiryStatus {
  level: ExpiryLevel;
  daysUntil: number; // negative if already expired
}

export function evaluateExpiry(
  isoDate: string,
  now: Date = new Date(),
): ExpiryStatus {
  const expiryMs = Date.parse(`${isoDate}T00:00:00Z`);
  const diffMs = expiryMs - now.getTime();
  const daysUntil = Math.floor(diffMs / MS_PER_DAY);
  if (daysUntil < 0) return { level: "expired", daysUntil };
  if (daysUntil <= WARNING_WINDOW_DAYS) return { level: "soon", daysUntil };
  return { level: "ok", daysUntil };
}

/**
 * Emit a single human-readable warning line to stderr describing the API-key
 * expiry status. No-op when level is `"ok"` and `verbose` is false. Under
 * `--verbose`, always emit a status line for diagnostics.
 */
export function warnAboutExpiry(
  isoDate: string | undefined,
  verbose: boolean,
  write: (line: string) => void = (s) => {
    process.stderr.write(s);
  },
  now: Date = new Date(),
): void {
  if (isoDate === undefined) {
    if (verbose) {
      write("[mic-tool] SONIOX_API_KEY_EXPIRES_AT not set — expiry tracking disabled\n");
    }
    return;
  }
  const status = evaluateExpiry(isoDate, now);
  if (status.level === "expired") {
    const days = Math.abs(status.daysUntil);
    write(
      `[mic-tool] WARNING: SONIOX_API_KEY expired ${days} day${days === 1 ? "" : "s"} ago (${isoDate}). Renew at https://console.soniox.com.\n`,
    );
    return;
  }
  if (status.level === "soon") {
    write(
      `[mic-tool] WARNING: SONIOX_API_KEY expires in ${status.daysUntil} day${status.daysUntil === 1 ? "" : "s"} (${isoDate}). Plan a renewal.\n`,
    );
    return;
  }
  // level === "ok"
  if (verbose) {
    write(
      `[mic-tool] SONIOX_API_KEY expires in ${status.daysUntil} days (${isoDate})\n`,
    );
  }
}
