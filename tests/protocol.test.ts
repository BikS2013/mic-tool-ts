import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import {
  findFirstMarker,
  normalizeOrdinaryMarker,
  stripMarkersForDisplay,
} from "../src/protocol/markerMatcher.js";
import { VoiceCommandStateMachine } from "../src/protocol/stateMachine.js";
import { JsonlProtocolWriter } from "../src/protocol/jsonlWriter.js";
import {
  VoiceAgentProtocolController,
  detectLanguage,
  targetLanguageFor,
} from "../src/protocol/controller.js";
import { FocusedInputDeliveryError } from "../src/platform/macos/focusedInputHelper.js";
import type { MarkerConfig, OperatorState } from "../src/protocol/types.js";
import type { Renderer } from "../src/render/renderer.js";
import type { LLMRefiner } from "../src/llm/types.js";

const MARKERS: MarkerConfig = Object.freeze({
  commandPhrase: "command",
  sectionEndPhrase: "command send",
  sectionEndAliases: Object.freeze(["τέλος εντολής"]),
  sectionCancelPhrase: "command cancel",
  literalNextPhrase: "literal phrase",
});

const OFF: OperatorState = Object.freeze({
  refine: false,
  translate: false,
  clipboard: false,
  input: false,
});

const DEFINITIONS = [
  { kind: "state_command" as const, phrases: [MARKERS.commandPhrase] },
  {
    kind: "section_end" as const,
    phrases: [MARKERS.sectionEndPhrase, ...MARKERS.sectionEndAliases],
  },
  { kind: "section_cancel" as const, phrases: [MARKERS.sectionCancelPhrase] },
  { kind: "literal_next" as const, phrases: [MARKERS.literalNextPhrase] },
];

function fakeRenderer(): Renderer & {
  partial: ReturnType<typeof vi.fn>;
  final: ReturnType<typeof vi.fn>;
  turnBoundary: ReturnType<typeof vi.fn>;
  refined: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
} {
  return {
    partial: vi.fn(),
    final: vi.fn(),
    turnBoundary: vi.fn(),
    refined: vi.fn(),
    dispose: vi.fn(),
  };
}

function fakeRefiner(fn: (text: string) => Promise<string>): LLMRefiner & {
  refine: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
} {
  return {
    refine: vi.fn(fn),
    dispose: vi.fn(),
  };
}

function enabledOperators(...enabled: (keyof OperatorState)[]): OperatorState {
  return {
    refine: enabled.includes("refine"),
    translate: enabled.includes("translate"),
    clipboard: enabled.includes("clipboard"),
    input: enabled.includes("input"),
  };
}

function parseJsonl(out: PassThrough): unknown[] {
  const text = out.read()?.toString("utf8") ?? "";
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("protocol marker matching", () => {
  it("normalizes ordinary marker aliases by case, accents, and punctuation", () => {
    expect(normalizeOrdinaryMarker("Τέλος,   Εντολής!")).toBe("τελοσ εντολησ");
    const match = findFirstMarker("κείμενο ΤΕΛΟΣ ΕΝΤΟΛΗΣ.", DEFINITIONS);
    expect(match?.kind).toBe("section_end");
  });

  it("matches command-prefixed markers without matching larger words", () => {
    expect(findFirstMarker("command refine", DEFINITIONS)?.kind).toBe(
      "state_command",
    );
    expect(findFirstMarker("this commandment is text", DEFINITIONS)).toBeNull();
    expect(findFirstMarker("please command send", DEFINITIONS)?.kind).toBe(
      "section_end",
    );
  });

  it("strips markers and state command args from display text", () => {
    expect(
      stripMarkersForDisplay(
        "hello command refine world command send",
        DEFINITIONS,
      ),
    ).toBe("hello world");
  });
});

describe("VoiceCommandStateMachine", () => {
  it("updates refine, translate, clipboard, and input state", () => {
    const sm = new VoiceCommandStateMachine({
      markers: MARKERS,
      initialOperators: OFF,
      translationPolicy: "opposite",
    });
    expect(sm.processFinal("command refine").actions).toContainEqual({
      type: "state.changed",
      key: "refine",
      value: true,
      targetPolicy: undefined,
    });
    sm.processFinal("command translate");
    sm.processFinal("command clipboard");
    sm.processFinal("command input");
    expect(sm.state).toEqual({
      refine: true,
      translate: true,
      clipboard: true,
      input: true,
    });
  });

  it("toggles operators through runtime controls", () => {
    const sm = new VoiceCommandStateMachine({
      markers: MARKERS,
      initialOperators: {
        refine: true,
        translate: false,
        clipboard: false,
        input: false,
      },
      translationPolicy: "opposite",
    });

    expect(sm.toggleOperator("refine")).toEqual({
      type: "state.changed",
      key: "refine",
      value: false,
      targetPolicy: undefined,
    });
    expect(sm.toggleOperator("translate")).toEqual({
      type: "state.changed",
      key: "translate",
      value: true,
      targetPolicy: "opposite",
    });
    expect(sm.state).toEqual({
      refine: false,
      translate: true,
      clipboard: false,
      input: false,
    });
  });

  it("reports operator status without changing state", () => {
    const sm = new VoiceCommandStateMachine({
      markers: MARKERS,
      initialOperators: enabledOperators("refine", "clipboard", "input"),
      translationPolicy: "to-en",
    });
    const result = sm.processFinal("command status");
    expect(result.visibleText).toBe("");
    expect(result.actions).toContainEqual({
      type: "status.reported",
      operators: { refine: true, translate: false, clipboard: true, input: true },
      translation_policy: "to-en",
      pending_section: false,
    });
    expect(sm.state).toEqual({
      refine: true,
      translate: false,
      clipboard: true,
      input: true,
    });
  });

  it("reports a pending section when status is spoken after dictated text", () => {
    const sm = new VoiceCommandStateMachine({
      markers: MARKERS,
      initialOperators: OFF,
      translationPolicy: "opposite",
    });
    const result = sm.processFinal("draft text command status");
    expect(result.visibleText).toBe("draft text");
    expect(result.actions).toContainEqual({
      type: "status.reported",
      operators: OFF,
      translation_policy: "opposite",
      pending_section: true,
    });
    expect(sm.drainForShutdown()).toContainEqual({
      type: "section.cancelled",
      sectionId: "sec_000001",
      reason: "shutdown",
    });
  });

  it("submits the current section and strips the command send marker from raw text", () => {
    const sm = new VoiceCommandStateMachine({
      markers: MARKERS,
      initialOperators: enabledOperators("refine"),
      translationPolicy: "opposite",
    });
    const result = sm.processFinal("Open the design docs. command send");
    expect(result.actions).toContainEqual({
      type: "section.submitted",
      sectionId: "sec_000001",
      rawText: "Open the design docs.",
      operators: ["refine"],
    });
  });

  it("matches a section-end alias across consecutive final segments", () => {
    const sm = new VoiceCommandStateMachine({
      markers: MARKERS,
      initialOperators: OFF,
      translationPolicy: "opposite",
    });
    expect(sm.processFinal("γράψε αυτό τέλος").actions).toEqual([]);
    const result = sm.processFinal("εντολής");
    expect(result.actions).toContainEqual({
      type: "section.submitted",
      sectionId: "sec_000001",
      rawText: "γράψε αυτό",
      operators: [],
    });
  });

  it("cancels the current section on command cancel", () => {
    const sm = new VoiceCommandStateMachine({
      markers: MARKERS,
      initialOperators: OFF,
      translationPolicy: "opposite",
    });
    const result = sm.processFinal("discard this command cancel");
    expect(result.actions).toContainEqual({
      type: "section.cancelled",
      sectionId: "sec_000001",
      reason: "spoken_cancel",
    });
  });

  it("emits a shutdown cancellation for an unsubmitted section", () => {
    const sm = new VoiceCommandStateMachine({
      markers: MARKERS,
      initialOperators: OFF,
      translationPolicy: "opposite",
    });
    sm.processFinal("unsubmitted text");
    expect(sm.drainForShutdown()).toEqual([
      {
        type: "section.cancelled",
        sectionId: "sec_000001",
        reason: "shutdown",
      },
    ]);
  });

  it("can submit the current section during shutdown", () => {
    const sm = new VoiceCommandStateMachine({
      markers: MARKERS,
      initialOperators: enabledOperators("refine"),
      translationPolicy: "opposite",
    });
    sm.processFinal("hotkey dictated text");
    expect(sm.drainForShutdown({ submitPending: true })).toEqual([
      {
        type: "section.submitted",
        sectionId: "sec_000001",
        rawText: "hotkey dictated text",
        operators: ["refine"],
      },
    ]);
  });
});

describe("JSONL protocol controller", () => {
  it("emits state.changed when runtime hotkeys toggle operators", async () => {
    const out = new PassThrough();
    const writer = new JsonlProtocolWriter({ out });
    const controller = new VoiceAgentProtocolController({
      mode: "agent-protocol",
      renderer: fakeRenderer(),
      writer,
      markers: MARKERS,
      initialOperators: OFF,
      translationPolicy: "opposite",
    });

    controller.startSession();
    controller.toggleOperator("clipboard");
    await controller.endSession("test");

    expect(parseJsonl(out)).toMatchObject([
      { type: "session.started", seq: 1 },
      { type: "state.changed", seq: 2, key: "clipboard", value: true },
      { type: "session.ended", seq: 3 },
    ]);
  });

  it("emits valid JSONL with monotonic seq values and no renderer carriage returns in agent mode", async () => {
    const out = new PassThrough();
    const renderer = fakeRenderer();
    const writer = new JsonlProtocolWriter({ out });
    const controller = new VoiceAgentProtocolController({
      mode: "agent-protocol",
      renderer,
      writer,
      markers: MARKERS,
      initialOperators: OFF,
      translationPolicy: "opposite",
      refiner: fakeRefiner(async (text) => text),
    });

    controller.startSession();
    controller.partial("ignored partial");
    controller.final("command refine");
    controller.final("Open docs. command send");
    await controller.endSession("test");

    expect(renderer.partial).not.toHaveBeenCalled();
    expect(renderer.final).not.toHaveBeenCalled();
    const events = parseJsonl(out);
    expect(events).toMatchObject([
      { type: "session.started", seq: 1 },
      { type: "state.changed", seq: 2, key: "refine", value: true },
      { type: "section.submitted", seq: 3, raw_text: "Open docs." },
      { type: "section.processed", seq: 4, output_text: "Open docs." },
      { type: "session.ended", seq: 5, reason: "test" },
    ]);
    expect(JSON.stringify(events)).not.toContain("\r");
  });

  it("emits a status.reported event in agent protocol mode", async () => {
    const out = new PassThrough();
    const renderer = fakeRenderer();
    const controller = new VoiceAgentProtocolController({
      mode: "agent-protocol",
      renderer,
      writer: new JsonlProtocolWriter({ out }),
      markers: MARKERS,
      initialOperators: enabledOperators("refine", "clipboard", "input"),
      translationPolicy: "to-en",
    });

    controller.startSession();
    controller.final("draft command status");
    await controller.endSession("test");

    expect(renderer.final).not.toHaveBeenCalled();
    expect(renderer.refined).not.toHaveBeenCalled();
    expect(parseJsonl(out)).toContainEqual(
      expect.objectContaining({
        type: "status.reported",
        operators: { refine: true, translate: false, clipboard: true, input: true },
        translation_policy: "to-en",
        pending_section: true,
      }),
    );
  });

  it("includes refined and translated fields on successful operator processing", async () => {
    const out = new PassThrough();
    const writer = new JsonlProtocolWriter({ out });
    const refiner = fakeRefiner(async () => "Καλημέρα κόσμε.");
    const translator = fakeRefiner(async () => "Good morning world.");
    const controller = new VoiceAgentProtocolController({
      mode: "agent-protocol",
      renderer: fakeRenderer(),
      writer,
      markers: MARKERS,
      initialOperators: enabledOperators("refine", "translate"),
      translationPolicy: "opposite",
      refiner,
      translator,
    });

    controller.startSession();
    controller.final("καλημέρα κόσμε command send");
    await controller.endSession("test");

    const processed = parseJsonl(out).find(
      (event) =>
        typeof event === "object" &&
        event !== null &&
        (event as { type?: string }).type === "section.processed",
    ) as Record<string, unknown>;
    expect(processed).toMatchObject({
      operators: ["refine", "translate"],
      raw_text: "καλημέρα κόσμε",
      refined_text: "Καλημέρα κόσμε.",
      source_language: "el",
      target_language: "en",
      output_text: "Good morning world.",
    });
  });

  it("copies processed output when clipboard is enabled", async () => {
    const out = new PassThrough();
    const clipboardWriter = vi.fn(async () => {});
    const controller = new VoiceAgentProtocolController({
      mode: "agent-protocol",
      renderer: fakeRenderer(),
      writer: new JsonlProtocolWriter({ out }),
      markers: MARKERS,
      initialOperators: enabledOperators("clipboard"),
      translationPolicy: "opposite",
      clipboardWriter,
    });

    controller.startSession();
    controller.final("copy me command send");
    await controller.endSession("test");

    expect(clipboardWriter).toHaveBeenCalledWith("copy me");
    expect(parseJsonl(out)).toContainEqual(
      expect.objectContaining({
        type: "clipboard.copied",
        section_id: "sec_000001",
      }),
    );
  });

  it("sends processed output to the focused input when input is enabled", async () => {
    const out = new PassThrough();
    const inputWriter = vi.fn(async () => {});
    const controller = new VoiceAgentProtocolController({
      mode: "agent-protocol",
      renderer: fakeRenderer(),
      writer: new JsonlProtocolWriter({ out }),
      markers: MARKERS,
      initialOperators: enabledOperators("input"),
      translationPolicy: "opposite",
      inputWriter,
    });

    controller.startSession();
    controller.final("paste me command send");
    await controller.endSession("test");

    expect(inputWriter).toHaveBeenCalledWith("paste me");
    expect(parseJsonl(out)).toContainEqual(
      expect.objectContaining({
        type: "input.sent",
        section_id: "sec_000001",
      }),
    );
  });

  it("sends the final refined and translated output to focused input", async () => {
    const out = new PassThrough();
    const inputWriter = vi.fn(async () => {});
    const refiner = fakeRefiner(async () => "Καλημέρα κόσμε.");
    const translator = fakeRefiner(async () => "Good morning world.");
    const controller = new VoiceAgentProtocolController({
      mode: "agent-protocol",
      renderer: fakeRenderer(),
      writer: new JsonlProtocolWriter({ out }),
      markers: MARKERS,
      initialOperators: enabledOperators("refine", "translate", "input"),
      translationPolicy: "opposite",
      refiner,
      translator,
      inputWriter,
    });

    controller.startSession();
    controller.final("καλημέρα κόσμε command send");
    await controller.endSession("test");

    expect(inputWriter).toHaveBeenCalledWith("Good morning world.");
    expect(parseJsonl(out)).toContainEqual(
      expect.objectContaining({
        type: "input.sent",
        section_id: "sec_000001",
      }),
    );
  });

  it("emits a protocol warning when focused input delivery fails", async () => {
    const stderrWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const out = new PassThrough();
    const inputWriter = vi.fn(async () => {
      throw new Error("not allowed");
    });
    const controller = new VoiceAgentProtocolController({
      mode: "agent-protocol",
      renderer: fakeRenderer(),
      writer: new JsonlProtocolWriter({ out }),
      markers: MARKERS,
      initialOperators: enabledOperators("input"),
      translationPolicy: "opposite",
      inputWriter,
    });

    try {
      controller.startSession();
      controller.final("paste me command send");
      await controller.endSession("test");
    } finally {
      stderrWrite.mockRestore();
    }

    const events = parseJsonl(out);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "protocol.warning",
        message: expect.stringContaining("input operator failed: not allowed"),
      }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: "input.sent",
      }),
    );
  });

  it("explains macOS accessibility remediation for System Events keystroke denial", async () => {
    const stderrWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const out = new PassThrough();
    const inputWriter = vi.fn(async () => {
      throw new Error(
        "osascript exited 1: execution error: System Events got an error: osascript is not allowed to send keystrokes. (1002)",
      );
    });
    const controller = new VoiceAgentProtocolController({
      mode: "agent-protocol",
      renderer: fakeRenderer(),
      writer: new JsonlProtocolWriter({ out }),
      markers: MARKERS,
      initialOperators: enabledOperators("input"),
      translationPolicy: "opposite",
      inputWriter,
    });

    try {
      controller.startSession();
      controller.final("paste me command send");
      await controller.endSession("test");
    } finally {
      stderrWrite.mockRestore();
    }

    expect(parseJsonl(out)).toContainEqual(
      expect.objectContaining({
        type: "protocol.warning",
        message: expect.stringContaining(
          "System Settings > Privacy & Security > Accessibility",
        ),
      }),
    );
  });

  it("explains macOS accessibility remediation for native helper denial", async () => {
    const stderrWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const out = new PassThrough();
    const inputWriter = vi.fn(async () => {
      throw new FocusedInputDeliveryError(
        "accessibility_not_trusted: Grant Accessibility permission to mic-tool-ts-input-helper.",
        { code: "accessibility_not_trusted" },
      );
    });
    const controller = new VoiceAgentProtocolController({
      mode: "agent-protocol",
      renderer: fakeRenderer(),
      writer: new JsonlProtocolWriter({ out }),
      markers: MARKERS,
      initialOperators: enabledOperators("input"),
      translationPolicy: "opposite",
      inputWriter,
    });

    try {
      controller.startSession();
      controller.final("paste me command send");
      await controller.endSession("test");
    } finally {
      stderrWrite.mockRestore();
    }

    expect(parseJsonl(out)).toContainEqual(
      expect.objectContaining({
        type: "protocol.warning",
        message: expect.stringContaining("mic-tool-ts-input-helper"),
      }),
    );
  });

  it("renders dictation text and processed output in dictation mode", async () => {
    const renderer = fakeRenderer();
    const refiner = fakeRefiner(async () => "Polished.");
    const controller = new VoiceAgentProtocolController({
      mode: "dictation",
      renderer,
      markers: MARKERS,
      initialOperators: enabledOperators("refine"),
      translationPolicy: "opposite",
      refiner,
    });

    controller.partial("partial");
    controller.final("rough text command send");
    await flushMicrotasks();
    await controller.endSession("test");

    expect(renderer.partial).toHaveBeenCalledWith("partial");
    expect(renderer.final).toHaveBeenCalledWith("rough text");
    expect(renderer.turnBoundary).toHaveBeenCalledOnce();
    expect(renderer.refined).toHaveBeenCalledWith("Polished.");
  });

  it("processes pending dictation text when endSession requests submission", async () => {
    const renderer = fakeRenderer();
    const refiner = fakeRefiner(async () => "Polished hotkey text.");
    const controller = new VoiceAgentProtocolController({
      mode: "dictation",
      renderer,
      markers: MARKERS,
      initialOperators: enabledOperators("refine"),
      translationPolicy: "opposite",
      refiner,
    });

    controller.final("rough hotkey text");
    await controller.endSession("ui-stop", { submitPending: true });

    expect(renderer.turnBoundary).toHaveBeenCalledOnce();
    expect(renderer.refined).toHaveBeenCalledWith("Polished hotkey text.");
  });

  it("renders status reports in dictation mode", () => {
    const renderer = fakeRenderer();
    const controller = new VoiceAgentProtocolController({
      mode: "dictation",
      renderer,
      markers: MARKERS,
      initialOperators: enabledOperators("translate"),
      translationPolicy: "opposite",
    });

    controller.final("command status");

    expect(renderer.final).not.toHaveBeenCalled();
    expect(renderer.refined).toHaveBeenCalledWith(
      "[mic-tool-ts] status: refine=off, translate=on, clipboard=off, input=off, translation_policy=opposite, pending_section=no",
    );
  });
});

describe("language helpers", () => {
  it("detects Greek text and computes opposite targets", () => {
    expect(detectLanguage("Καλημέρα")).toBe("el");
    expect(detectLanguage("Good morning")).toBe("en");
    expect(targetLanguageFor("el", "opposite")).toBe("en");
    expect(targetLanguageFor("en", "opposite")).toBe("el");
    expect(targetLanguageFor("el", "to-en")).toBe("en");
    expect(targetLanguageFor("en", "to-el")).toBe("el");
  });
});
