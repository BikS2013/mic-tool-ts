export type SttProvider = "soniox" | "elevenlabs";

export const STT_PROVIDERS: readonly SttProvider[] = [
  "soniox",
  "elevenlabs",
] as const;

export interface Transcriber {
  /** Open the provider realtime transcription session. */
  start(): Promise<void>;
  /** Forward a chunk of PCM s16le mono audio to the live session. */
  pushAudio(chunk: Buffer): void;
  /** Commit the current utterance without closing the live session. */
  commit(): Promise<void>;
  /** Gracefully finalize and close the session. Idempotent. */
  stop(): Promise<void>;
  /** Register a partial-transcript callback. */
  onPartial(cb: (text: string) => void): void;
  /** Register a final-transcript callback. */
  onFinal(cb: (text: string) => void): void;
  /** Register a mid-stream error callback. */
  onError(cb: (err: Error) => void): void;
}

export interface TranscriberOptions {
  /** Active STT provider. */
  provider: SttProvider;
  /** Active provider API key. */
  apiKey: string;
  /** Provider realtime model id/name. */
  model: string;
  /** Provider WebSocket endpoint. */
  endpoint: string;
  /** Language hints OR ["auto"]. ElevenLabs accepts only one explicit code. */
  languages: string[];
  /** Audio sample rate in Hz. */
  sampleRate: number;
  /** Provider-specific endpoint/VAD detection setting. */
  enableEndpointDetection: boolean;
  /** Diagnostic logging to stderr. */
  verbose: boolean;
}
