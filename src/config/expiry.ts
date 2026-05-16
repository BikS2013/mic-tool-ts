/**
 * Operational expiry tracking for provider API keys. Per CLAUDE.md
 * `<configuration-guide>`, expiring credentials should have an associated
 * YYYY-MM-DD reminder so the tool can warn proactively.
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

export interface ExpiryWarningOptions {
  readonly envName: string;
  readonly isoDate: string | undefined;
  readonly renewUrl: string;
  readonly verbose: boolean;
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
  optionsOrIsoDate: ExpiryWarningOptions | string | undefined,
  verbose = false,
  write: (line: string) => void = (s) => {
    process.stderr.write(s);
  },
  now: Date = new Date(),
): void {
  const options: ExpiryWarningOptions =
    typeof optionsOrIsoDate === "object" && optionsOrIsoDate !== null
      ? optionsOrIsoDate
      : {
          envName: "SONIOX_API_KEY",
          isoDate: optionsOrIsoDate,
          renewUrl: "https://console.soniox.com",
          verbose,
        };
  const { envName, isoDate, renewUrl } = options;
  verbose = options.verbose;

  if (isoDate === undefined) {
    if (verbose) {
      write(`[mic-tool-ts] ${envName}_EXPIRES_AT not set — expiry tracking disabled\n`);
    }
    return;
  }
  const status = evaluateExpiry(isoDate, now);
  if (status.level === "expired") {
    const days = Math.abs(status.daysUntil);
    write(
      `[mic-tool-ts] WARNING: ${envName} expired ${days} day${days === 1 ? "" : "s"} ago (${isoDate}). Renew at ${renewUrl}.\n`,
    );
    return;
  }
  if (status.level === "soon") {
    write(
      `[mic-tool-ts] WARNING: ${envName} expires in ${status.daysUntil} day${status.daysUntil === 1 ? "" : "s"} (${isoDate}). Plan a renewal.\n`,
    );
    return;
  }
  // level === "ok"
  if (verbose) {
    write(
      `[mic-tool-ts] ${envName} expires in ${status.daysUntil} days (${isoDate})\n`,
    );
  }
}
