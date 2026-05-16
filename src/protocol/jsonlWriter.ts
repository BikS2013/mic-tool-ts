import type {
  ProtocolEvent,
  ProtocolWriter,
  ProtocolWriterOptions,
  SequencedProtocolEvent,
} from "./types.js";

export class JsonlProtocolWriter implements ProtocolWriter {
  private readonly out: NodeJS.WritableStream;
  private readonly closeOnEnd: boolean;
  private seq = 0;
  private ended = false;

  constructor(opts: ProtocolWriterOptions) {
    this.out = opts.out;
    this.closeOnEnd = opts.closeOnEnd ?? false;
  }

  write(event: ProtocolEvent): void {
    if (this.ended) return;
    this.seq += 1;
    const sequenced: SequencedProtocolEvent = {
      ...event,
      seq: this.seq,
    };
    this.out.write(`${JSON.stringify(sequenced)}\n`);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.closeOnEnd) {
      this.out.end();
    }
  }
}

