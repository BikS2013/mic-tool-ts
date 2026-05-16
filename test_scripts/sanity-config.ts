/**
 * Sanity check for src/config.ts (Unit A).
 *
 * NOT a real test suite — Phase 9 owns proper testing. This script exercises
 * the public surface of `resolveConfig` enough to prove it runs end-to-end
 * across the precedence chain and the validation paths.
 *
 * Run with: pnpm exec tsx test_scripts/sanity-config.ts
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chdir, cwd as getCwd } from "node:process";

import {
  HelpOrVersionShown,
  resolveConfig,
  type ResolvedConfig,
} from "../src/config.js";
import {
  InvalidConfigurationError,
  MissingConfigurationError,
} from "../src/errors.js";

// ---------------------------------------------------------------------------
// Tiny assertion helpers
// ---------------------------------------------------------------------------

let failures = 0;

function assertEq<T>(label: string, actual: T, expected: T): void {
  if (actual === expected) {
    process.stdout.write(`  ok   ${label}\n`);
  } else {
    failures += 1;
    process.stdout.write(
      `  FAIL ${label}\n         expected: ${String(expected)}\n         actual:   ${String(actual)}\n`,
    );
  }
}

function assertThrows(
  label: string,
  fn: () => unknown,
  matcher: (err: unknown) => boolean,
): void {
  let threw: unknown;
  try {
    fn();
  } catch (err) {
    threw = err;
  }
  if (threw !== undefined && matcher(threw)) {
    process.stdout.write(`  ok   ${label}\n`);
  } else {
    failures += 1;
    process.stdout.write(
      `  FAIL ${label}\n         got: ${threw instanceof Error ? `${threw.name}: ${threw.message}` : String(threw)}\n`,
    );
  }
}

// ---------------------------------------------------------------------------
// Test harness — each block runs in a clean cwd with cleared SONIOX_API_KEY.
// ---------------------------------------------------------------------------

const originalCwd = getCwd();
const originalKey = process.env.SONIOX_API_KEY;

function withTempCwd(envContents: string | null, body: () => void): void {
  const dir = mkdtempSync(join(tmpdir(), "mic-tool-sanity-"));
  if (envContents !== null) {
    writeFileSync(join(dir, ".env"), envContents, "utf8");
  }
  chdir(dir);
  try {
    body();
  } finally {
    chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  }
}

function withShellEnv(value: string | undefined, body: () => void): void {
  const prev = process.env.SONIOX_API_KEY;
  if (value === undefined) delete process.env.SONIOX_API_KEY;
  else process.env.SONIOX_API_KEY = value;
  try {
    body();
  } finally {
    if (prev === undefined) delete process.env.SONIOX_API_KEY;
    else process.env.SONIOX_API_KEY = prev;
  }
}

function argv(...flags: string[]): string[] {
  return ["node", "mic-tool", ...flags];
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

process.stdout.write("Unit A sanity checks\n");

// 1. Defaults + flag-provided key
process.stdout.write("\n[1] defaults + --api-key\n");
withTempCwd(null, () => {
  withShellEnv(undefined, () => {
    const cfg: ResolvedConfig = resolveConfig(argv("--api-key", "sk_from_flag"));
    assertEq("apiKey", cfg.apiKey, "sk_from_flag");
    assertEq("language default", cfg.language, "en");
    assertEq("outputMode default", cfg.outputMode, "overwrite");
    assertEq("verbose default", cfg.verbose, false);
  });
});

// 2. Precedence: flag > .env > shell env
process.stdout.write("\n[2] precedence chain\n");

withTempCwd("SONIOX_API_KEY=sk_from_dotenv\n", () => {
  withShellEnv("sk_from_shell", () => {
    // Flag wins
    const a = resolveConfig(argv("--api-key", "sk_from_flag"));
    assertEq("flag beats .env and shell", a.apiKey, "sk_from_flag");

    // .env wins over shell (no flag)
    const b = resolveConfig(argv());
    assertEq(".env beats shell env", b.apiKey, "sk_from_dotenv");
  });
});

withTempCwd(null, () => {
  withShellEnv("sk_from_shell", () => {
    const c = resolveConfig(argv());
    assertEq("shell env used when no flag and no .env", c.apiKey, "sk_from_shell");
  });
});

// 3. Missing-key error
process.stdout.write("\n[3] missing-key error\n");
withTempCwd(null, () => {
  withShellEnv(undefined, () => {
    assertThrows(
      "throws MissingConfigurationError when no key anywhere",
      () => resolveConfig(argv()),
      (err) => err instanceof MissingConfigurationError,
    );
  });
});

// 4. Invalid --language
process.stdout.write("\n[4] invalid language\n");
withTempCwd(null, () => {
  withShellEnv("sk", () => {
    assertThrows(
      "rejects 'english' as a language",
      () => resolveConfig(argv("--language", "english")),
      (err) => err instanceof InvalidConfigurationError,
    );
    const cfg = resolveConfig(argv("--language", "auto"));
    assertEq("'auto' is accepted", cfg.language, "auto");
    const cfg2 = resolveConfig(argv("--language", "pt-BR"));
    assertEq("'pt-BR' is accepted", cfg2.language, "pt-BR");
  });
});

// 5. Invalid --output-mode (caught by commander and remapped)
process.stdout.write("\n[5] invalid output-mode\n");
withTempCwd(null, () => {
  withShellEnv("sk", () => {
    assertThrows(
      "rejects unknown output-mode",
      () => resolveConfig(argv("--output-mode", "weird")),
      (err) => err instanceof InvalidConfigurationError,
    );
    const cfg = resolveConfig(argv("--output-mode", "final-only"));
    assertEq("'final-only' is accepted", cfg.outputMode, "final-only");
  });
});

// 6. Verbose flag + stderr log
process.stdout.write("\n[6] verbose flag\n");
withTempCwd(null, () => {
  withShellEnv("sk_v", () => {
    const cfg = resolveConfig(argv("-v"));
    assertEq("verbose=true", cfg.verbose, true);
  });
});

// 7. --help and --version surface as HelpOrVersionShown
process.stdout.write("\n[7] help / version sentinel\n");
withTempCwd(null, () => {
  withShellEnv(undefined, () => {
    assertThrows(
      "--help raises HelpOrVersionShown",
      () => {
        // commander writes to stdout; suppress for cleaner output
        const origWrite = process.stdout.write.bind(process.stdout);
        process.stdout.write = (() => true) as typeof process.stdout.write;
        try {
          resolveConfig(argv("--help"));
        } finally {
          process.stdout.write = origWrite;
        }
      },
      (err) =>
        err instanceof HelpOrVersionShown &&
        (err as HelpOrVersionShown).kind === "help",
    );
    assertThrows(
      "--version raises HelpOrVersionShown",
      () => {
        const origWrite = process.stdout.write.bind(process.stdout);
        process.stdout.write = (() => true) as typeof process.stdout.write;
        try {
          resolveConfig(argv("--version"));
        } finally {
          process.stdout.write = origWrite;
        }
      },
      (err) =>
        err instanceof HelpOrVersionShown &&
        (err as HelpOrVersionShown).kind === "version",
    );
  });
});

// 8. Empty-string values are treated as missing
process.stdout.write("\n[8] empty/whitespace values\n");
withTempCwd("SONIOX_API_KEY=   \n", () => {
  withShellEnv(undefined, () => {
    assertThrows(
      "whitespace-only .env value is treated as missing",
      () => resolveConfig(argv()),
      (err) => err instanceof MissingConfigurationError,
    );
  });
});

// ---------------------------------------------------------------------------
// Wrap-up
// ---------------------------------------------------------------------------

if (originalKey === undefined) delete process.env.SONIOX_API_KEY;
else process.env.SONIOX_API_KEY = originalKey;

process.stdout.write(
  failures === 0
    ? "\nAll sanity checks passed.\n"
    : `\n${failures} sanity check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
