/**
 * Shared error taxonomy for mic-tool.
 *
 * Every error class derived from {@link MicToolError} carries a stable string
 * `code` slug (for log/grep diagnostics) and a process `exitCode` that the
 * top-level orchestrator forwards to `process.exit`.
 *
 * Exit-code map (from project-design.md §3.5):
 *   2 = configuration error (missing / invalid)
 *   3 = mic capture environment problem (unavailable, permission, platform)
 *   4 = Soniox authentication
 *   5 = Soniox network / connection
 *   6 = Soniox protocol / unexpected response shape
 */

export interface MicToolErrorOptions {
  cause?: unknown;
}

export class MicToolError extends Error {
  public readonly code: string;
  public readonly exitCode: number;

  constructor(
    message: string,
    code: string,
    exitCode: number,
    options?: MicToolErrorOptions,
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = code;
    this.exitCode = exitCode;
  }
}

export class MissingConfigurationError extends MicToolError {
  constructor(message: string, options?: MicToolErrorOptions) {
    super(message, "missing_configuration", 2, options);
  }
}

export class InvalidConfigurationError extends MicToolError {
  constructor(message: string, options?: MicToolErrorOptions) {
    super(message, "invalid_configuration", 2, options);
  }
}

export class MicNotAvailableError extends MicToolError {
  constructor(message: string, options?: MicToolErrorOptions) {
    super(message, "mic_not_available", 3, options);
  }
}

export class MicPermissionDeniedError extends MicToolError {
  constructor(message: string, options?: MicToolErrorOptions) {
    super(message, "mic_permission_denied", 3, options);
  }
}

export class UnsupportedPlatformError extends MicToolError {
  constructor(message: string, options?: MicToolErrorOptions) {
    super(message, "unsupported_platform", 3, options);
  }
}

export class SonioxAuthError extends MicToolError {
  constructor(message: string, options?: MicToolErrorOptions) {
    super(message, "soniox_auth", 4, options);
  }
}

export class SonioxNetworkError extends MicToolError {
  constructor(message: string, options?: MicToolErrorOptions) {
    super(message, "soniox_network", 5, options);
  }
}

export class SonioxProtocolError extends MicToolError {
  constructor(message: string, options?: MicToolErrorOptions) {
    super(message, "soniox_protocol", 6, options);
  }
}

/**
 * Startup-time LLM configuration failure (e.g. `--refine` is on but the
 * required Azure OpenAI env vars are missing). Exit code 2 — handled exactly
 * like any other invalid configuration.
 */
export class LLMConfigurationError extends MicToolError {
  constructor(message: string, options?: MicToolErrorOptions) {
    super(message, "llm_configuration", 2, options);
  }
}

/**
 * Runtime LLM failure (auth, network, timeout, malformed response). NOT
 * fatal — the orchestrator logs it (under verbose) and continues. The
 * `kind` field discriminates the failure mode for diagnostics.
 */
export class LLMRefinementError extends MicToolError {
  public readonly kind: "auth" | "network" | "timeout" | "server" | "shape";
  constructor(
    message: string,
    kind: "auth" | "network" | "timeout" | "server" | "shape",
    options?: MicToolErrorOptions,
  ) {
    super(message, `llm_refinement_${kind}`, 0, options);
    this.kind = kind;
  }
}
