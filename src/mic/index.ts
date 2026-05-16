/**
 * Factory that returns the correct {@link MicSource} for the current platform.
 *
 * v1 supports macOS only; other platforms throw {@link UnsupportedPlatformError}.
 */

import { UnsupportedPlatformError } from "../errors.js";
import { SoxMicSource } from "./soxMicSource.js";
import type { MicSource } from "./types.js";

export function createMicSource(): MicSource {
  if (process.platform === "darwin") {
    return new SoxMicSource();
  }
  throw new UnsupportedPlatformError(
    `mic-tool v1 supports macOS only (detected ${process.platform})`,
  );
}
