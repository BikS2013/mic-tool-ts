/**
 * Factory that returns the correct {@link MicSource} for the current platform.
 *
 * v1 supports macOS only; other platforms throw {@link UnsupportedPlatformError}.
 */

import { UnsupportedPlatformError } from "../errors.js";
import { SoxMicSource } from "./soxMicSource.js";
import type { MicSource } from "./types.js";

export interface CreateMicSourceOptions {
  /** PCM sample rate (Hz). Default: 16000. */
  sampleRate?: number;
  /** Verbose diagnostics to stderr. */
  verbose?: boolean;
}

export function createMicSource(opts: CreateMicSourceOptions = {}): MicSource {
  if (process.platform === "darwin") {
    return new SoxMicSource({
      sampleRate: opts.sampleRate,
      verbose: opts.verbose,
    });
  }
  throw new UnsupportedPlatformError(
    `mic-tool-ts v1 supports macOS only (detected ${process.platform})`,
  );
}
