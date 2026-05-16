import { ElevenLabsTranscriber } from "../elevenlabs/client.js";
import { SonioxTranscriber } from "../soniox/client.js";
import type { Transcriber, TranscriberOptions } from "./types.js";

export function createTranscriber(opts: TranscriberOptions): Transcriber {
  switch (opts.provider) {
    case "soniox":
      return new SonioxTranscriber(opts);
    case "elevenlabs":
      return new ElevenLabsTranscriber(opts);
  }
}
