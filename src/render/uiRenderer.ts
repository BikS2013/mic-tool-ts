import type { SessionEventSink } from "../core/sessionEvents.js";
import type { Renderer } from "./renderer.js";

export class UiRenderer implements Renderer {
  private disposed = false;

  constructor(private readonly emit: SessionEventSink) {}

  partial(text: string): void {
    if (this.disposed || text.length === 0) return;
    this.emit({ type: "transcript.partial", text });
  }

  final(text: string): void {
    if (this.disposed || text.length === 0) return;
    this.emit({ type: "transcript.final", text });
  }

  turnBoundary(): void {
    if (this.disposed) return;
    this.emit({ type: "transcript.turnBoundary" });
  }

  refined(text: string): void {
    if (this.disposed || text.length === 0) return;
    this.emit({ type: "transcript.refined", text });
  }

  dispose(): void {
    this.disposed = true;
  }
}
