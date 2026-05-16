/**
 * Unit B contract — Microphone audio source.
 *
 * Implementations spawn a platform-specific capture subprocess (e.g. `sox` on
 * macOS) and expose its raw PCM stdout as a Node {@link Readable}.
 */

import type { Readable } from "node:stream";

export interface MicSource {
  /** Readable stream emitting Buffer chunks of PCM s16le mono 16 kHz audio. */
  readonly audio: Readable;
  /** Start mic capture. Resolves once audio is flowing. */
  start(): Promise<void>;
  /** Stop mic capture. Idempotent. Resolves once the subprocess has exited. */
  stop(): Promise<void>;
}

/** Audio format constants — all mic implementations and the Soniox session
 *  must agree on these values. */
export const AUDIO_SAMPLE_RATE = 16000;
export const AUDIO_CHANNELS = 1;
export const AUDIO_BITS = 16;
export const AUDIO_ENCODING = "pcm_s16le" as const;
