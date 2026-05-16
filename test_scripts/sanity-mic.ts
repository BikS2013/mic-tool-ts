/**
 * Sanity smoke for {@link SoxMicSource} (Unit B).
 *
 * Tries to start the macOS sox-backed mic source, log a success line if it
 * spawned, and then stop it after 200 ms. On any failure it prints the error
 * class name and message — which makes this script handy when `sox` is not
 * installed, when mic permission has been denied, or when no default audio
 * input device is present.
 *
 * Run with: `pnpm exec tsx test_scripts/sanity-mic.ts`
 *
 * This script is intentionally NOT executed by CI — it is an interactive,
 * environment-dependent smoke test.
 */

import { SoxMicSource } from "../src/mic/soxMicSource.js";

async function main(): Promise<void> {
  const mic = new SoxMicSource({ verbose: true });

  let bytesReceived = 0;
  mic.audio.on("data", (chunk: Buffer) => {
    bytesReceived += chunk.length;
  });
  mic.audio.on("error", (err: Error) => {
    process.stderr.write(`[sanity-mic] audio 'error': ${err.name}: ${err.message}\n`);
  });
  mic.audio.on("end", () => {
    process.stderr.write("[sanity-mic] audio stream 'end'\n");
  });

  try {
    await mic.start();
    process.stderr.write("[sanity-mic] mic.start() succeeded\n");
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    process.stderr.write(`[sanity-mic] received ${bytesReceived} bytes in 200 ms\n`);
    await mic.stop();
    process.stderr.write("[sanity-mic] mic.stop() resolved\n");
  } catch (err) {
    const name = err instanceof Error ? err.constructor.name : "unknown";
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[sanity-mic] FAILED: ${name}: ${message}\n`);
    // Best-effort cleanup so we don't leave a zombie sox child.
    try {
      await mic.stop();
    } catch {
      /* ignore */
    }
    process.exitCode = 1;
  }
}

void main();
