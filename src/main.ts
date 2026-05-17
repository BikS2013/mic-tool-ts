import { runMicSession } from "./core/sessionRunner.js";

/**
 * CLI entry point used by src/index.ts and tests. The implementation lives in
 * the shared session runner so Electron UI mode and terminal mode use the same
 * transcription, protocol, shutdown, and persistence path.
 */
export async function main(argv: string[]): Promise<number> {
  return runMicSession(argv, { frontend: "cli" });
}
