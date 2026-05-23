import { describe, expect, it } from "vitest";

import {
  calculateOverlayBounds,
  initialOverlayState,
  overlayDiagnosticSummary,
  reduceOverlayEvent,
} from "../src/ui/transcriptionOverlayState.js";

const DEFAULT_HOTKEY = "Control+`";

describe("transcription overlay state", () => {
  it("shows on hotkey recording and replaces live partial text in place", () => {
    const recording = reduceOverlayEvent(initialOverlayState(), {
      type: "capture.state",
      state: "recording",
      reason: "push-to-talk pressed",
    }, {
      hotkeyOwned: true,
      hotkey: DEFAULT_HOTKEY,
    });

    expect(recording.action).toEqual({ kind: "show" });
    expect(recording.snapshot).toMatchObject({
      visible: true,
      phase: "recording",
      text: "Waiting for audio...",
      hotkey: DEFAULT_HOTKEY,
      protocolFeatures: {
        refine: false,
        translate: false,
        clipboard: false,
        input: false,
      },
    });

    const partial = reduceOverlayEvent(recording.state, {
      type: "transcript.partial",
      text: "first partial",
    }, {
      hotkeyOwned: true,
      hotkey: DEFAULT_HOTKEY,
    });

    const replaced = reduceOverlayEvent(partial.state, {
      type: "transcript.partial",
      text: "replacement partial",
    }, {
      hotkeyOwned: true,
      hotkey: DEFAULT_HOTKEY,
    });

    expect(replaced.action).toEqual({ kind: "show" });
    expect(replaced.snapshot.text).toBe("replacement partial");
  });

  it("briefly keeps final text after release before scheduling hide", () => {
    const recording = reduceOverlayEvent(initialOverlayState(), {
      type: "capture.state",
      state: "recording",
    }, {
      hotkeyOwned: true,
      hotkey: DEFAULT_HOTKEY,
    });

    const warm = reduceOverlayEvent(recording.state, {
      type: "capture.state",
      state: "warm",
      reason: "push-to-talk released",
    }, {
      hotkeyOwned: true,
      hotkey: DEFAULT_HOTKEY,
    });

    expect(warm.action).toEqual({ kind: "schedule-hide", delayMs: 1100 });
    expect(warm.snapshot).toMatchObject({
      visible: true,
      phase: "finalizing",
    });

    const final = reduceOverlayEvent(warm.state, {
      type: "transcript.final",
      text: "committed text",
    }, {
      hotkeyOwned: true,
      hotkey: DEFAULT_HOTKEY,
    });

    expect(final.action).toEqual({ kind: "schedule-hide", delayMs: 1100 });
    expect(final.snapshot).toMatchObject({
      visible: true,
      phase: "finalizing",
      text: "committed text",
    });
  });

  it("keeps the overlay visible when final text arrives while the hotkey is still pressed", () => {
    const recording = reduceOverlayEvent(initialOverlayState(), {
      type: "capture.state",
      state: "recording",
    }, {
      hotkeyOwned: true,
      hotkey: DEFAULT_HOTKEY,
    });

    const final = reduceOverlayEvent(recording.state, {
      type: "transcript.final",
      text: "committed before release",
    }, {
      hotkeyOwned: true,
      hotkey: DEFAULT_HOTKEY,
    });

    expect(final.action).toEqual({ kind: "show" });
    expect(final.state.isRecording).toBe(true);
    expect(final.snapshot).toMatchObject({
      visible: true,
      phase: "recording",
      text: "committed before release",
    });

    const released = reduceOverlayEvent(final.state, {
      type: "capture.state",
      state: "warm",
      reason: "push-to-talk released",
    }, {
      hotkeyOwned: true,
      hotkey: DEFAULT_HOTKEY,
    });

    expect(released.action).toEqual({ kind: "schedule-hide", delayMs: 1100 });
  });

  it("does not show for manual-session transcript events", () => {
    const partial = reduceOverlayEvent(initialOverlayState(), {
      type: "transcript.partial",
      text: "manual text",
    }, {
      hotkeyOwned: false,
      hotkey: DEFAULT_HOTKEY,
    });

    expect(partial.action).toEqual({ kind: "none" });
    expect(partial.snapshot.visible).toBe(false);
    expect(partial.snapshot.text).toBe("");
  });

  it("updates protocol feature indicators while visible", () => {
    const recording = reduceOverlayEvent(initialOverlayState(), {
      type: "capture.state",
      state: "recording",
    }, {
      hotkeyOwned: true,
      hotkey: DEFAULT_HOTKEY,
      protocolFeatures: {
        refine: false,
        translate: false,
        clipboard: true,
        input: false,
      },
    });

    const changed = reduceOverlayEvent(recording.state, {
      type: "protocol.event",
      event: {
        type: "state.changed",
        key: "input",
        value: true,
      },
    }, {
      hotkeyOwned: true,
      hotkey: DEFAULT_HOTKEY,
      protocolFeatures: {
        refine: false,
        translate: false,
        clipboard: true,
        input: false,
      },
    });

    expect(changed.action).toEqual({ kind: "show" });
    expect(changed.snapshot.protocolFeatures).toEqual({
      refine: false,
      translate: false,
      clipboard: true,
      input: true,
    });
  });

  it("carries protocol features from context into snapshots", () => {
    const recording = reduceOverlayEvent(initialOverlayState(), {
      type: "capture.state",
      state: "recording",
    }, {
      hotkeyOwned: true,
      hotkey: DEFAULT_HOTKEY,
      protocolFeatures: {
        refine: true,
        translate: false,
        clipboard: true,
        input: true,
      },
    });

    expect(recording.snapshot.protocolFeatures).toEqual({
      refine: true,
      translate: false,
      clipboard: true,
      input: true,
    });
  });

  it("clears transcript text when capture returns to idle", () => {
    const recording = reduceOverlayEvent(initialOverlayState(), {
      type: "capture.state",
      state: "recording",
    }, {
      hotkeyOwned: true,
      hotkey: DEFAULT_HOTKEY,
    });
    const partial = reduceOverlayEvent(recording.state, {
      type: "transcript.partial",
      text: "private transcript",
    }, {
      hotkeyOwned: true,
      hotkey: DEFAULT_HOTKEY,
    });

    const idle = reduceOverlayEvent(partial.state, {
      type: "capture.state",
      state: "idle",
    }, {
      hotkeyOwned: false,
      hotkey: DEFAULT_HOTKEY,
    });

    expect(idle.action).toEqual({ kind: "hide" });
    expect(idle.snapshot.visible).toBe(false);
    expect(idle.snapshot.text).toBe("");
  });

  it("summarizes overlay diagnostics without transcript content", () => {
    const recording = reduceOverlayEvent(initialOverlayState(), {
      type: "capture.state",
      state: "recording",
    }, {
      hotkeyOwned: true,
      hotkey: DEFAULT_HOTKEY,
    });
    const final = reduceOverlayEvent(recording.state, {
      type: "transcript.final",
      text: "private dictated text",
    }, {
      hotkeyOwned: true,
      hotkey: DEFAULT_HOTKEY,
    });

    const summary = overlayDiagnosticSummary({
      type: "transcript.final",
      text: "private dictated text",
    }, {
      hotkeyOwned: true,
      hotkey: DEFAULT_HOTKEY,
    }, final.snapshot, final.action);

    expect(summary).toContain("event=transcript.final");
    expect(summary).toContain("action=show");
    expect(summary).toContain("textPresent=true");
    expect(summary).not.toContain("private dictated text");
  });

  it("places the overlay at bottom center within the active work area", () => {
    expect(calculateOverlayBounds({
      x: 100,
      y: 50,
      width: 1440,
      height: 900,
    })).toEqual({
      x: 350,
      y: 798,
      width: 940,
      height: 128,
    });

    expect(calculateOverlayBounds({
      x: 0,
      y: 0,
      width: 360,
      height: 260,
    })).toEqual({
      x: 24,
      y: 108,
      width: 312,
      height: 128,
    });
  });
});
