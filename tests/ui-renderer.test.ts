import { describe, expect, it } from "vitest";

import type { SessionEvent } from "../src/core/sessionEvents.js";
import { UiRenderer } from "../src/render/uiRenderer.js";

describe("UiRenderer", () => {
  it("emits transcript events instead of writing to stdout", () => {
    const events: SessionEvent[] = [];
    const renderer = new UiRenderer((event) => events.push(event));

    renderer.partial("working");
    renderer.final("done");
    renderer.turnBoundary();
    renderer.refined("polished");

    expect(events).toEqual([
      { type: "transcript.partial", text: "working" },
      { type: "transcript.final", text: "done" },
      { type: "transcript.turnBoundary" },
      { type: "transcript.refined", text: "polished" },
    ]);
  });

  it("ignores transcript writes after dispose", () => {
    const events: SessionEvent[] = [];
    const renderer = new UiRenderer((event) => events.push(event));

    renderer.dispose();
    renderer.partial("ignored");
    renderer.final("ignored");
    renderer.refined("ignored");
    renderer.turnBoundary();

    expect(events).toEqual([]);
  });
});
