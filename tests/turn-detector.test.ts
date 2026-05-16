/**
 * Tests for the guard-phrase turn detector (`src/turn/detector.ts`).
 *
 * The detector wraps a Renderer and watches finalized text for a configured
 * guard phrase. On a match, it asks the inner renderer to emit a turn
 * boundary (blank line) and resets its rolling buffer. Matching is
 * accent/case/punctuation insensitive.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  GuardPhraseTurnDetector,
  normalizeForMatch,
} from "../src/turn/detector.js";
import type { Renderer } from "../src/render/renderer.js";
import type { LLMRefiner } from "../src/llm/types.js";
import { LLMRefinementError } from "../src/errors.js";

function makeFakeRenderer(): Renderer & {
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

function makeFakeRefiner(
  impl?: (text: string) => Promise<string>,
): LLMRefiner & {
  refine: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
} {
  return {
    refine: vi.fn(impl ?? (async (t: string) => `refined(${t})`)),
    dispose: vi.fn(),
  };
}

/** Yield a few microtasks so an `await`ed async IIFE inside the detector
 *  gets a chance to settle. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("normalizeForMatch", () => {
  it("strips Greek diacritics", () => {
    expect(normalizeForMatch("τέλος εντολής")).toBe("τελος εντολης");
  });

  it("lowercases", () => {
    expect(normalizeForMatch("HELLO World")).toBe("hello world");
  });

  it("collapses punctuation and runs of whitespace into single spaces", () => {
    expect(normalizeForMatch("  hello,   world!!!  ")).toBe("hello world");
  });

  it("returns empty string for input with no letters or digits", () => {
    expect(normalizeForMatch("   !!! ... ")).toBe("");
  });
});

describe("GuardPhraseTurnDetector", () => {
  let inner: ReturnType<typeof makeFakeRenderer>;

  beforeEach(() => {
    inner = makeFakeRenderer();
  });

  it("passes partial() through to the inner renderer untouched", () => {
    const d = new GuardPhraseTurnDetector(inner, {
      guardPhrase: "τέλος εντολής",
    });
    d.partial("hello");
    expect(inner.partial).toHaveBeenCalledWith("hello");
    expect(inner.turnBoundary).not.toHaveBeenCalled();
  });

  it("forwards final() to the inner renderer even when no match", () => {
    const d = new GuardPhraseTurnDetector(inner, {
      guardPhrase: "τέλος εντολής",
    });
    d.final("some random text");
    expect(inner.final).toHaveBeenCalledWith("some random text");
    expect(inner.turnBoundary).not.toHaveBeenCalled();
  });

  it("triggers turnBoundary when the guard phrase appears in a single final", () => {
    const d = new GuardPhraseTurnDetector(inner, {
      guardPhrase: "τέλος εντολής",
    });
    d.final("κάνε αυτό τέλος εντολής");
    expect(inner.final).toHaveBeenCalledWith("κάνε αυτό τέλος εντολής");
    expect(inner.turnBoundary).toHaveBeenCalledTimes(1);
  });

  it("triggers turnBoundary when the guard phrase spans across consecutive finals", () => {
    const d = new GuardPhraseTurnDetector(inner, {
      guardPhrase: "τέλος εντολής",
    });
    d.final("κάνε αυτό");
    expect(inner.turnBoundary).not.toHaveBeenCalled();
    d.final("τέλος");
    expect(inner.turnBoundary).not.toHaveBeenCalled();
    d.final("εντολής");
    expect(inner.turnBoundary).toHaveBeenCalledTimes(1);
  });

  it("matches regardless of accent / case / trailing punctuation", () => {
    const d = new GuardPhraseTurnDetector(inner, {
      guardPhrase: "τέλος εντολής",
    });
    d.final("ΤΕΛΟΣ ΕΝΤΟΛΗΣ.");
    expect(inner.turnBoundary).toHaveBeenCalledTimes(1);
  });

  it("resets the buffer after a turn boundary so a later half-match does not re-fire", () => {
    const d = new GuardPhraseTurnDetector(inner, {
      guardPhrase: "τέλος εντολής",
    });
    // First turn closes.
    d.final("hello τέλος εντολής");
    expect(inner.turnBoundary).toHaveBeenCalledTimes(1);

    // Now only the second half of the phrase appears — should NOT fire again.
    d.final("εντολής of something else");
    expect(inner.turnBoundary).toHaveBeenCalledTimes(1);

    // But a fresh full match should still fire.
    d.final("ok and now τέλος εντολής");
    expect(inner.turnBoundary).toHaveBeenCalledTimes(2);
  });

  it("emits the verbose log line when verbose=true and a boundary fires", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const d = new GuardPhraseTurnDetector(inner, {
      guardPhrase: "stop now",
      verbose: true,
    });
    d.final("we stop now please");
    expect(stderr).toHaveBeenCalledWith(
      "[mic-tool-ts] turn boundary detected\n",
    );
    stderr.mockRestore();
  });

  it("does NOT emit the verbose log when verbose is false (default)", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const d = new GuardPhraseTurnDetector(inner, { guardPhrase: "stop now" });
    d.final("we stop now please");
    expect(stderr).not.toHaveBeenCalled();
    stderr.mockRestore();
  });

  it("delegates dispose() to the inner renderer", () => {
    const d = new GuardPhraseTurnDetector(inner, {
      guardPhrase: "τέλος εντολής",
    });
    d.dispose();
    expect(inner.dispose).toHaveBeenCalledTimes(1);
  });

  it("throws if the guard phrase normalizes to an empty string", () => {
    expect(
      () =>
        new GuardPhraseTurnDetector(inner, { guardPhrase: "!!! ??? ..." }),
    ).toThrow(/normalized to an empty string/);
  });

  it("respects the rolling buffer cap (long turns do not OOM and old context rolls off)", () => {
    const d = new GuardPhraseTurnDetector(inner, {
      guardPhrase: "τέλος εντολής",
    });
    // Stream a lot of large unrelated finals — well over the 2000-char cap.
    for (let i = 0; i < 50; i++) {
      d.final("x".repeat(100));
    }
    expect(inner.turnBoundary).not.toHaveBeenCalled();
    // After the cap has rolled, the phrase should still trigger if it appears.
    d.final("κάτι τέλος εντολής");
    expect(inner.turnBoundary).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// LLM refiner integration
// ---------------------------------------------------------------------------

describe("GuardPhraseTurnDetector — LLM refiner integration", () => {
  let inner: ReturnType<typeof makeFakeRenderer>;

  beforeEach(() => {
    inner = makeFakeRenderer();
  });

  it("calls refiner.refine with the turn text (guard phrase stripped) on a boundary", async () => {
    const refiner = makeFakeRefiner();
    const d = new GuardPhraseTurnDetector(inner, {
      guardPhrase: "τέλος εντολής",
      refiner,
    });
    d.final("κάνε αυτό τέλος εντολής");
    await flushMicrotasks();
    expect(refiner.refine).toHaveBeenCalledTimes(1);
    const [arg] = refiner.refine.mock.calls[0]!;
    expect(arg).not.toContain("τέλος εντολής");
    expect(arg.trim()).toBe("κάνε αυτό");
  });

  it("renders the refined text via renderer.refined() on success", async () => {
    const refiner = makeFakeRefiner(async () => "Polished result.");
    const d = new GuardPhraseTurnDetector(inner, {
      guardPhrase: "stop",
      refiner,
    });
    d.final("hello world stop");
    await flushMicrotasks();
    expect(inner.refined).toHaveBeenCalledWith("Polished result.");
  });

  it("swallows refiner.refine() rejections and never crashes the detector", async () => {
    const refiner = makeFakeRefiner(async () => {
      throw new LLMRefinementError("boom", "network");
    });
    const d = new GuardPhraseTurnDetector(inner, {
      guardPhrase: "stop",
      refiner,
    });
    d.final("text stop");
    await flushMicrotasks();
    expect(inner.refined).not.toHaveBeenCalled();
    // The detector is still healthy — a subsequent boundary still works.
    refiner.refine.mockImplementationOnce(async () => "second");
    d.final("more text stop");
    await flushMicrotasks();
    expect(inner.refined).toHaveBeenCalledWith("second");
  });

  it("logs the failure under verbose=true with a tag identifying the failure kind", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const refiner = makeFakeRefiner(async () => {
      throw new LLMRefinementError("auth boom", "auth");
    });
    const d = new GuardPhraseTurnDetector(inner, {
      guardPhrase: "stop",
      verbose: true,
      refiner,
    });
    d.final("text stop");
    await flushMicrotasks();
    const stderrText = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrText).toContain("refinement failed (llm-auth)");
    expect(stderrText).toContain("auth boom");
    stderr.mockRestore();
  });

  it("does NOT invoke renderer.refined() if dispose() ran before the refiner resolved", async () => {
    let resolveRefine: (v: string) => void = () => {};
    const refiner = makeFakeRefiner(
      () => new Promise<string>((res) => { resolveRefine = res; }),
    );
    const d = new GuardPhraseTurnDetector(inner, {
      guardPhrase: "stop",
      refiner,
    });
    d.final("text stop");
    // Refine is in flight. Dispose first; refiner resolves AFTER dispose.
    d.dispose();
    resolveRefine("late");
    await flushMicrotasks();
    expect(inner.refined).not.toHaveBeenCalled();
  });

  it("does nothing extra when refiner is null/undefined", async () => {
    const d = new GuardPhraseTurnDetector(inner, {
      guardPhrase: "stop",
      refiner: null,
    });
    d.final("text stop");
    await flushMicrotasks();
    expect(inner.refined).not.toHaveBeenCalled();
    expect(inner.turnBoundary).toHaveBeenCalledTimes(1);
  });

  it("dispose() also disposes the refiner", () => {
    const refiner = makeFakeRefiner();
    const d = new GuardPhraseTurnDetector(inner, {
      guardPhrase: "stop",
      refiner,
    });
    d.dispose();
    expect(refiner.dispose).toHaveBeenCalledTimes(1);
  });
});
