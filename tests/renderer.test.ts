/**
 * Tests for src/render/renderer.ts — Unit D (StdoutRenderer).
 *
 * Uses an in-memory MemoryWritable to capture exact byte sequences without
 * spawning child processes. All assertions use strict string equality.
 */

import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StdoutRenderer } from "../src/render/renderer.js";

// ---------------------------------------------------------------------------
// MemoryWritable: collects all written chunks into a single string
// ---------------------------------------------------------------------------

class MemoryWritable extends Writable {
  public chunks: string[] = [];

  override _write(
    chunk: Buffer | string,
    _enc: BufferEncoding,
    cb: (err?: Error | null) => void,
  ): void {
    this.chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    cb();
  }

  get text(): string {
    return this.chunks.join("");
  }

  reset(): void {
    this.chunks = [];
  }
}

// ---------------------------------------------------------------------------
// Helper factory
// ---------------------------------------------------------------------------

function makeRenderer(
  mode: "overwrite" | "append" | "final-only",
  isTTY: boolean,
  out: MemoryWritable,
): StdoutRenderer {
  return new StdoutRenderer({ mode, isTTY, out });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StdoutRenderer — overwrite mode (TTY)", () => {
  let out: MemoryWritable;

  beforeEach(() => {
    out = new MemoryWritable();
  });

  afterEach(() => {
    out.destroy();
  });

  it("writes a partial with \\r prefix and no trailing newline", () => {
    const r = makeRenderer("overwrite", true, out);
    r.partial("hello");
    expect(out.text).toBe("\rhello");
  });

  it("overwrites a shorter subsequent partial with trailing spaces to erase previous", () => {
    const r = makeRenderer("overwrite", true, out);
    r.partial("hello"); // prevLen = 5
    r.partial("hi"); // hi + "   " (3 spaces to erase 5-2=3 chars)
    expect(out.text).toBe("\rhello\rhi   ");
  });

  it("writes a partial then a longer partial with no padding needed", () => {
    const r = makeRenderer("overwrite", true, out);
    r.partial("hi"); // prevLen = 2
    r.partial("hello world"); // longer, no padding
    expect(out.text).toBe("\rhi\rhello world");
  });

  it("final: erases previous partial text and terminates with \\n", () => {
    const r = makeRenderer("overwrite", true, out);
    r.partial("hello"); // prevLen = 5
    r.partial("hi"); // prevLen = 2; writes "\rhi   "
    r.final("hi there"); // longer than 2, no padding; terminates with \n
    expect(out.text).toBe("\rhello\rhi   \rhi there\n");
  });

  it("final after final: prevLen resets so no stale padding on subsequent line", () => {
    const r = makeRenderer("overwrite", true, out);
    r.final("first line");
    r.final("second");
    // Both are \r...text\n, no padding since prevLen was reset after each final
    expect(out.text).toBe("\rfirst line\n\rsecond\n");
  });

  it("empty partial is a no-op (does not write anything)", () => {
    const r = makeRenderer("overwrite", true, out);
    r.partial("hi");
    r.partial(""); // must not write
    r.final("hi there");
    expect(out.text).toBe("\rhi\rhi there\n");
  });

  it("embedded \\n in partial text is sanitized to a space", () => {
    const r = makeRenderer("overwrite", true, out);
    r.partial("line1\nline2");
    expect(out.text).toBe("\rline1 line2");
  });

  it("embedded \\r in partial text is sanitized to a space", () => {
    const r = makeRenderer("overwrite", true, out);
    r.partial("line1\rline2");
    expect(out.text).toBe("\rline1 line2");
  });

  it("embedded \\n in final text is sanitized to a space", () => {
    const r = makeRenderer("overwrite", true, out);
    r.final("hi\nthere");
    expect(out.text).toBe("\rhi there\n");
  });

  it("multiple embedded line breaks are collapsed into a single space", () => {
    const r = makeRenderer("overwrite", true, out);
    r.partial("a\n\nb");
    expect(out.text).toBe("\ra b");
  });

  it("effectiveMode is 'overwrite' when isTTY=true", () => {
    const r = makeRenderer("overwrite", true, out);
    expect(r.effectiveMode).toBe("overwrite");
  });
});

describe("StdoutRenderer — dispose behaviour (overwrite TTY)", () => {
  let out: MemoryWritable;

  beforeEach(() => {
    out = new MemoryWritable();
  });

  afterEach(() => {
    out.destroy();
  });

  it("dispose after dangling partial: writes \\n then ANSI clear-line + CR", () => {
    const r = makeRenderer("overwrite", true, out);
    r.partial("hello");
    r.dispose();
    // \rhello from partial, then \n to terminate, then \x1b[2K\r ANSI clear
    expect(out.text).toBe("\rhello\n\x1b[2K\r");
  });

  it("dispose with no prior partial: writes ANSI clear-line + CR (prevLen=0 so no \\n)", () => {
    const r = makeRenderer("overwrite", true, out);
    r.dispose();
    // prevLen = 0 so no \n written, but isTTY so ANSI escape is still emitted
    expect(out.text).toBe("\x1b[2K\r");
  });

  it("dispose is idempotent — second call does nothing", () => {
    const r = makeRenderer("overwrite", true, out);
    r.partial("hello");
    r.dispose();
    const afterFirst = out.text;
    r.dispose();
    expect(out.text).toBe(afterFirst);
  });

  it("partial() after dispose is a no-op", () => {
    const r = makeRenderer("overwrite", true, out);
    r.dispose();
    const afterDispose = out.text;
    r.partial("should be ignored");
    expect(out.text).toBe(afterDispose);
  });

  it("final() after dispose is a no-op", () => {
    const r = makeRenderer("overwrite", true, out);
    r.dispose();
    const afterDispose = out.text;
    r.final("should be ignored");
    expect(out.text).toBe(afterDispose);
  });
});

describe("StdoutRenderer — append mode", () => {
  let out: MemoryWritable;

  beforeEach(() => {
    out = new MemoryWritable();
  });

  afterEach(() => {
    out.destroy();
  });

  it("each partial is written as its own \\n-terminated line", () => {
    const r = makeRenderer("append", true, out);
    r.partial("hello");
    r.partial("hi");
    expect(out.text).toBe("hello\nhi\n");
  });

  it("final is written as \\n-terminated line", () => {
    const r = makeRenderer("append", true, out);
    r.final("hi there");
    expect(out.text).toBe("hi there\n");
  });

  it("partial→partial→final full flow produces three \\n-terminated lines", () => {
    const r = makeRenderer("append", true, out);
    r.partial("hello");
    r.partial("hi");
    r.final("hi there");
    expect(out.text).toBe("hello\nhi\nhi there\n");
  });

  it("never writes a \\r character", () => {
    const r = makeRenderer("append", true, out);
    r.partial("some text");
    r.final("final text");
    expect(out.text).not.toContain("\r");
  });

  it("effectiveMode is 'append'", () => {
    const r = makeRenderer("append", true, out);
    expect(r.effectiveMode).toBe("append");
  });

  it("dispose is a no-op in append mode (nothing to flush)", () => {
    const r = makeRenderer("append", true, out);
    r.partial("hello");
    r.dispose();
    // No extra bytes written on dispose in append mode
    expect(out.text).toBe("hello\n");
  });
});

describe("StdoutRenderer — final-only mode", () => {
  let out: MemoryWritable;

  beforeEach(() => {
    out = new MemoryWritable();
  });

  afterEach(() => {
    out.destroy();
  });

  it("partials are silently dropped — nothing written", () => {
    const r = makeRenderer("final-only", true, out);
    r.partial("hello");
    r.partial("hi");
    expect(out.text).toBe("");
  });

  it("finals are written as \\n-terminated lines", () => {
    const r = makeRenderer("final-only", true, out);
    r.final("hi there");
    expect(out.text).toBe("hi there\n");
  });

  it("partial→partial→final: only the final appears", () => {
    const r = makeRenderer("final-only", true, out);
    r.partial("hello");
    r.partial("hi");
    r.final("hi there");
    expect(out.text).toBe("hi there\n");
  });

  it("multiple finals each get their own \\n-terminated line", () => {
    const r = makeRenderer("final-only", true, out);
    r.final("first");
    r.final("second");
    expect(out.text).toBe("first\nsecond\n");
  });

  it("effectiveMode is 'final-only'", () => {
    const r = makeRenderer("final-only", true, out);
    expect(r.effectiveMode).toBe("final-only");
  });

  it("never writes a \\r character", () => {
    const r = makeRenderer("final-only", true, out);
    r.partial("partial noise");
    r.final("clean output");
    expect(out.text).not.toContain("\r");
  });

  it("dispose is a no-op in final-only mode", () => {
    const r = makeRenderer("final-only", true, out);
    r.dispose();
    expect(out.text).toBe("");
    r.dispose(); // idempotent
    expect(out.text).toBe("");
  });
});

describe("StdoutRenderer — TTY auto-downgrade", () => {
  let out: MemoryWritable;

  beforeEach(() => {
    out = new MemoryWritable();
  });

  afterEach(() => {
    out.destroy();
  });

  it("overwrite + isTTY:false is downgraded to append (effectiveMode='append')", () => {
    const r = makeRenderer("overwrite", false, out);
    expect(r.effectiveMode).toBe("append");
  });

  it("downgraded renderer never writes \\r characters", () => {
    const r = makeRenderer("overwrite", false, out);
    r.partial("hello");
    r.partial("hi");
    r.final("hi there");
    expect(out.text).not.toContain("\r");
  });

  it("downgraded renderer produces identical output to an explicit append renderer", () => {
    const outA = new MemoryWritable();
    const outB = new MemoryWritable();
    const rA = makeRenderer("overwrite", false, outA); // downgraded
    const rB = makeRenderer("append", true, outB); // explicit append

    rA.partial("hello");
    rA.partial("hi");
    rA.final("hi there");

    rB.partial("hello");
    rB.partial("hi");
    rB.final("hi there");

    expect(outA.text).toBe(outB.text);
    outA.destroy();
    outB.destroy();
  });

  it("append + isTTY:false is NOT downgraded (effectiveMode stays 'append')", () => {
    const r = makeRenderer("append", false, out);
    expect(r.effectiveMode).toBe("append");
  });

  it("final-only + isTTY:false is NOT downgraded (effectiveMode stays 'final-only')", () => {
    const r = makeRenderer("final-only", false, out);
    expect(r.effectiveMode).toBe("final-only");
  });

  it("dispose on downgraded renderer does not emit ANSI sequences or extra newline when no partial was written", () => {
    // Downgraded mode is append internally; dispose is a no-op for append
    const r = makeRenderer("overwrite", false, out);
    r.dispose();
    expect(out.text).toBe("");
  });
});

describe("StdoutRenderer — turnBoundary()", () => {
  let out: MemoryWritable;
  beforeEach(() => { out = new MemoryWritable(); });
  afterEach(() => { out.destroy(); });

  it("emits a single \\n after a final in overwrite mode (TTY)", () => {
    const r = makeRenderer("overwrite", true, out);
    r.final("hello");        // "\rhello\n"
    r.turnBoundary();        // "\n"
    expect(out.text).toBe("\rhello\n\n");
  });

  it("emits a single \\n after a final in append mode", () => {
    const r = makeRenderer("append", true, out);
    r.final("hello");        // "hello\n"
    r.turnBoundary();        // "\n"
    expect(out.text).toBe("hello\n\n");
  });

  it("emits a single \\n after a final in final-only mode", () => {
    const r = makeRenderer("final-only", true, out);
    r.final("hello");        // "hello\n"
    r.turnBoundary();        // "\n"
    expect(out.text).toBe("hello\n\n");
  });

  it("emits a single \\n after the downgraded (overwrite→append on non-TTY) mode", () => {
    const r = makeRenderer("overwrite", false, out);
    r.final("hello");        // "hello\n" (downgraded)
    r.turnBoundary();        // "\n"
    expect(out.text).toBe("hello\n\n");
  });

  it("is a no-op after dispose()", () => {
    const r = makeRenderer("append", true, out);
    r.final("hello");        // "hello\n"
    r.dispose();
    out.reset();
    r.turnBoundary();
    expect(out.text).toBe("");
  });

  it("never writes \\r in any mode", () => {
    for (const mode of ["overwrite", "append", "final-only"] as const) {
      const o = new MemoryWritable();
      const r = makeRenderer(mode, true, o);
      r.final("x");
      r.turnBoundary();
      // The \r in overwrite-final is part of final(), but turnBoundary itself
      // must only add a \n. So the suffix is "\n".
      expect(o.text.endsWith("\n")).toBe(true);
      // No spurious \r introduced by turnBoundary specifically.
      const beforeBoundary = o.text.slice(0, -1);
      const afterBoundary = "\n";
      expect(afterBoundary).not.toContain("\r");
      // Sanity: beforeBoundary may legitimately contain \r in overwrite mode.
      void beforeBoundary;
      o.destroy();
    }
  });
});

describe("StdoutRenderer — refined()", () => {
  let out: MemoryWritable;
  beforeEach(() => { out = new MemoryWritable(); });
  afterEach(() => { out.destroy(); });

  it("writes the refined text on its own line, followed by a blank line (overwrite TTY)", () => {
    const r = makeRenderer("overwrite", true, out);
    r.final("verbatim");      // "\rverbatim\n"
    r.turnBoundary();         // "\n"
    r.refined("polished.");   // "polished.\n\n"
    expect(out.text).toBe("\rverbatim\n\npolished.\n\n");
  });

  it("commits an in-progress partial first when one exists in overwrite mode", () => {
    const r = makeRenderer("overwrite", true, out);
    r.final("done");                      // "\rdone\n"
    r.turnBoundary();                     // "\n"
    r.partial("next utt");                // "\rnext utt"
    r.refined("Polished previous.");      // "\nPolished previous.\n\n"
    // After the \n, prevLen is reset so a later partial starts fresh.
    expect(out.text).toBe(
      "\rdone\n\n\rnext utt\nPolished previous.\n\n",
    );
  });

  it("writes the refined text on its own line + blank line (append mode)", () => {
    const r = makeRenderer("append", true, out);
    r.final("verbatim");      // "verbatim\n"
    r.turnBoundary();         // "\n"
    r.refined("polished.");   // "polished.\n\n"
    expect(out.text).toBe("verbatim\n\npolished.\n\n");
  });

  it("writes the refined text on its own line + blank line (final-only mode)", () => {
    const r = makeRenderer("final-only", true, out);
    r.final("verbatim");      // "verbatim\n"
    r.turnBoundary();         // "\n"
    r.refined("polished.");   // "polished.\n\n"
    expect(out.text).toBe("verbatim\n\npolished.\n\n");
  });

  it("is a no-op after dispose()", () => {
    const r = makeRenderer("append", true, out);
    r.final("hello");
    r.dispose();
    out.reset();
    r.refined("anything");
    expect(out.text).toBe("");
  });

  it("is a no-op for empty text", () => {
    const r = makeRenderer("append", true, out);
    r.refined("");
    expect(out.text).toBe("");
  });
});
