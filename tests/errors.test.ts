/**
 * Tests for src/errors.ts — error-construction surface.
 *
 * Confirms each exported error class carries the correct stable `code` slug
 * and process `exitCode` as specified in the exit-code map in project-design.md §3.5.
 */

import { describe, expect, it } from "vitest";

import {
  InvalidConfigurationError,
  MicNotAvailableError,
  MicPermissionDeniedError,
  MicToolError,
  MissingConfigurationError,
  SonioxAuthError,
  SonioxNetworkError,
  SonioxProtocolError,
  UnsupportedPlatformError,
} from "../src/errors.js";

// ---------------------------------------------------------------------------
// Parameterised table: [class, expectedCode, expectedExitCode]
// ---------------------------------------------------------------------------

type ErrorConstructor = new (
  message: string,
  options?: { cause?: unknown },
) => MicToolError;

interface ErrorCase {
  ctor: ErrorConstructor;
  expectedCode: string;
  expectedExitCode: number;
  label: string;
}

const ERROR_TABLE: readonly ErrorCase[] = [
  {
    ctor: MissingConfigurationError,
    expectedCode: "missing_configuration",
    expectedExitCode: 2,
    label: "MissingConfigurationError",
  },
  {
    ctor: InvalidConfigurationError,
    expectedCode: "invalid_configuration",
    expectedExitCode: 2,
    label: "InvalidConfigurationError",
  },
  {
    ctor: MicNotAvailableError,
    expectedCode: "mic_not_available",
    expectedExitCode: 3,
    label: "MicNotAvailableError",
  },
  {
    ctor: MicPermissionDeniedError,
    expectedCode: "mic_permission_denied",
    expectedExitCode: 3,
    label: "MicPermissionDeniedError",
  },
  {
    ctor: UnsupportedPlatformError,
    expectedCode: "unsupported_platform",
    expectedExitCode: 3,
    label: "UnsupportedPlatformError",
  },
  {
    ctor: SonioxAuthError,
    expectedCode: "soniox_auth",
    expectedExitCode: 4,
    label: "SonioxAuthError",
  },
  {
    ctor: SonioxNetworkError,
    expectedCode: "soniox_network",
    expectedExitCode: 5,
    label: "SonioxNetworkError",
  },
  {
    ctor: SonioxProtocolError,
    expectedCode: "soniox_protocol",
    expectedExitCode: 6,
    label: "SonioxProtocolError",
  },
];

describe("Error taxonomy", () => {
  it.each(ERROR_TABLE)(
    "$label — code='$expectedCode', exitCode=$expectedExitCode",
    ({ ctor, expectedCode, expectedExitCode, label }) => {
      const err = new ctor("test message");

      expect(err.code).toBe(expectedCode);
      expect(err.exitCode).toBe(expectedExitCode);
      expect(err).toBeInstanceOf(MicToolError);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe(label);
      expect(err.message).toBe("test message");
    },
  );

  describe("MicToolError base class", () => {
    it("accepts a cause option and surfaces it", () => {
      const cause = new Error("root cause");
      const err = new MissingConfigurationError("wrapper", { cause });
      expect((err as Error & { cause?: unknown }).cause).toBe(cause);
    });

    it("instanceof chain is preserved across subclass hierarchy", () => {
      const err = new SonioxAuthError("auth failure");
      expect(err).toBeInstanceOf(SonioxAuthError);
      expect(err).toBeInstanceOf(MicToolError);
      expect(err).toBeInstanceOf(Error);
    });
  });
});
