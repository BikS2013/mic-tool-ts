import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { constants, accessSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type FocusedInputMethod = "ax-value" | "unicode-events" | "paste-keycode";

export interface FocusedInputDeliveryResult {
  readonly ok: boolean;
  readonly method?: FocusedInputMethod;
  readonly code?: string;
  readonly message?: string;
  readonly targetRole?: string;
  readonly targetSubrole?: string;
  readonly clipboardRestored?: boolean;
}

export interface FocusedInputHelperOptions {
  readonly helperPath?: string;
  readonly method?: "auto" | FocusedInputMethod;
  readonly timeoutMs?: number;
  readonly spawnProcess?: SpawnProcess;
}

export interface FocusedInputHelperPathOptions {
  readonly platform?: NodeJS.Platform;
  readonly moduleUrl?: string;
  readonly accessFile?: (path: string, mode: number) => void;
}

type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: {
    readonly stdio: ["pipe", "pipe", "pipe"];
  },
) => ChildProcessWithoutNullStreams;

const HELPER_RELATIVE_TO_COMPILED_MODULE =
  "../../native/macos/untype-input-helper";
const DEFAULT_TIMEOUT_MS = 10_000;

export class FocusedInputDeliveryError extends Error {
  readonly code?: string;
  readonly helperExitCode?: number | null;
  readonly diagnostics?: string;

  constructor(
    message: string,
    opts: {
      readonly code?: string;
      readonly helperExitCode?: number | null;
      readonly diagnostics?: string;
      readonly cause?: unknown;
    } = {},
  ) {
    super(message, { cause: opts.cause });
    this.name = "FocusedInputDeliveryError";
    this.code = opts.code;
    this.helperExitCode = opts.helperExitCode;
    this.diagnostics = opts.diagnostics;
  }
}

export async function sendToFocusedInput(text: string): Promise<void> {
  const result = await deliverToFocusedInput(text);
  if (!result.ok) {
    throw new FocusedInputDeliveryError(
      `${result.code ?? "focused_input_failed"}: ${result.message ?? "Focused input delivery failed."}`,
      { code: result.code },
    );
  }
}

export async function deliverToFocusedInput(
  text: string,
  opts: FocusedInputHelperOptions = {},
): Promise<FocusedInputDeliveryResult> {
  const helperPath = opts.helperPath ?? resolveFocusedInputHelperPath();
  const method = opts.method ?? "auto";
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const spawnProcess = opts.spawnProcess ?? spawn;
  const args = ["send", "--method", method] as const;

  return await new Promise<FocusedInputDeliveryResult>((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawnProcess(helperPath, args, { stdio: ["pipe", "pipe", "pipe"] });
    } catch (err) {
      reject(
        new FocusedInputDeliveryError("Could not start focused input helper.", {
          cause: err,
        }),
      );
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(
        new FocusedInputDeliveryError("Focused input helper timed out.", {
          code: "delivery_timeout",
          diagnostics: trimForDiagnostics(stderr),
        }),
      );
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new FocusedInputDeliveryError("Focused input helper process failed.", {
          cause: err,
          diagnostics: trimForDiagnostics(stderr),
        }),
      );
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        const parsed = parseHelperResult(stdout);
        if (parsed.ok && exitCode === 0) {
          resolve(parsed);
          return;
        }
        if (!parsed.ok && exitCode === 2) {
          resolve(parsed);
          return;
        }
        reject(
          new FocusedInputDeliveryError(
            `${parsed.code ?? "focused_input_helper_failed"}: ${parsed.message ?? "Focused input helper failed."}`,
            {
              code: parsed.code,
              helperExitCode: exitCode,
              diagnostics: trimForDiagnostics(stderr),
            },
          ),
        );
      } catch (err) {
        reject(
          new FocusedInputDeliveryError("Focused input helper returned invalid JSON.", {
            helperExitCode: exitCode,
            diagnostics: trimForDiagnostics(stderr),
            cause: err,
          }),
        );
      }
    });
    child.stdin.end(text);
  });
}

export function resolveFocusedInputHelperPath(
  opts: FocusedInputHelperPathOptions = {},
): string {
  const platform = opts.platform ?? process.platform;
  if (platform !== "darwin") {
    throw new FocusedInputDeliveryError(
      "Focused input delivery is only implemented on macOS.",
      { code: "unsupported_platform" },
    );
  }

  const moduleUrl = opts.moduleUrl ?? import.meta.url;
  const helperPath = fileURLToPath(
    new URL(HELPER_RELATIVE_TO_COMPILED_MODULE, moduleUrl),
  );
  const accessFile = opts.accessFile ?? accessSync;
  try {
    accessFile(helperPath, constants.X_OK);
  } catch (err) {
    throw new FocusedInputDeliveryError(
      `Focused input helper is not installed or executable at ${helperPath}. Rebuild untype so the native helper is bundled.`,
      { code: "helper_unavailable", cause: err },
    );
  }
  return helperPath;
}

export function parseHelperResult(stdout: string): FocusedInputDeliveryResult {
  const lines = stdout
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length !== 1) {
    throw new Error(`Expected one helper JSON line, received ${lines.length}.`);
  }

  const parsed: unknown = JSON.parse(lines[0]);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Helper result must be a JSON object.");
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.ok !== "boolean") {
    throw new Error("Helper result is missing boolean ok.");
  }

  const method = readOptionalString(record, "method");
  if (
    method !== undefined &&
    method !== "ax-value" &&
    method !== "unicode-events" &&
    method !== "paste-keycode"
  ) {
    throw new Error(`Unsupported helper method in result: ${method}.`);
  }

  return {
    ok: record.ok,
    method,
    code: readOptionalString(record, "code"),
    message: readOptionalString(record, "message"),
    targetRole: readOptionalString(record, "target_role"),
    targetSubrole: readOptionalString(record, "target_subrole"),
    clipboardRestored: readOptionalBoolean(record, "clipboard_restored"),
  };
}

function readOptionalString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`Helper field ${key} must be a string when present.`);
  }
  return value;
}

function readOptionalBoolean(
  record: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`Helper field ${key} must be a boolean when present.`);
  }
  return value;
}

function trimForDiagnostics(stderr: string): string | undefined {
  const trimmed = stderr.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 4_000) : undefined;
}
