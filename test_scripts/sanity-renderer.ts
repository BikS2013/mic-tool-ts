/**
 * Sanity smoke test for Unit D — StdoutRenderer.
 *
 * Run manually with:
 *   pnpm tsx test_scripts/sanity-renderer.ts
 *
 * The script constructs three renderers (one per mode) over an in-memory
 * `Writable` and asserts the captured byte sequence after a representative
 * partial→partial→final flow. A fourth case validates the TTY auto-downgrade
 * (overwrite + isTTY:false should behave exactly like append).
 *
 * No external dependencies: pure Node stdlib + the renderer under test.
 */

import { Writable } from "node:stream";
import { StdoutRenderer } from "../src/render/renderer.js";

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
}

interface Case {
  readonly name: string;
  readonly expected: string;
  readonly run: (out: MemoryWritable) => void;
}

const cases: readonly Case[] = [
  {
    name: "overwrite (TTY): partial→partial-shrink→final",
    // 1st partial: "\r" + "hello"                    (prevLen=0, no padding)
    // 2nd partial (shorter): "\r" + "hi" + "   "    (prevLen=5, pad 3)
    // final:                "\r" + "hi there" + "\n" (prevLen=2, no padding)
    expected: "\rhello\rhi   \rhi there\n",
    run: (out) => {
      const r = new StdoutRenderer({ mode: "overwrite", isTTY: true, out });
      r.partial("hello");
      r.partial("hi");
      r.final("hi there");
    },
  },
  {
    name: "append (TTY): partial→partial→final",
    expected: "hello\nhi\nhi there\n",
    run: (out) => {
      const r = new StdoutRenderer({ mode: "append", isTTY: true, out });
      r.partial("hello");
      r.partial("hi");
      r.final("hi there");
    },
  },
  {
    name: "final-only (TTY): partial→partial→final",
    expected: "hi there\n",
    run: (out) => {
      const r = new StdoutRenderer({ mode: "final-only", isTTY: true, out });
      r.partial("hello");
      r.partial("hi");
      r.final("hi there");
    },
  },
  {
    name: "overwrite + isTTY:false → downgraded to append (no \\r ever written)",
    expected: "hello\nhi\nhi there\n",
    run: (out) => {
      const r = new StdoutRenderer({ mode: "overwrite", isTTY: false, out });
      r.partial("hello");
      r.partial("hi");
      r.final("hi there");
    },
  },
  {
    name: "overwrite (TTY): dispose after dangling partial terminates line + clears it",
    // partial: "\rhello"; dispose: "\n" then "\x1b[2K\r"
    expected: "\rhello\n\x1b[2K\r",
    run: (out) => {
      const r = new StdoutRenderer({ mode: "overwrite", isTTY: true, out });
      r.partial("hello");
      r.dispose();
      // idempotency: second dispose is a no-op
      r.dispose();
    },
  },
  {
    name: "overwrite (TTY): empty partial is a no-op",
    expected: "\rhi\rhi there\n",
    run: (out) => {
      const r = new StdoutRenderer({ mode: "overwrite", isTTY: true, out });
      r.partial("hi");
      r.partial(""); // must NOT write anything
      r.final("hi there");
    },
  },
  {
    name: "overwrite (TTY): embedded \\n in partial is sanitized to space",
    expected: "\rhi there\n",
    run: (out) => {
      const r = new StdoutRenderer({ mode: "overwrite", isTTY: true, out });
      r.final("hi\nthere");
    },
  },
];

let failed = 0;
for (const c of cases) {
  const out = new MemoryWritable();
  c.run(out);
  const got = out.text;
  const ok = got === c.expected;
  if (!ok) {
    failed++;
    process.stderr.write(`FAIL  ${c.name}\n`);
    process.stderr.write(`  expected: ${JSON.stringify(c.expected)}\n`);
    process.stderr.write(`  got:      ${JSON.stringify(got)}\n`);
  } else {
    process.stdout.write(`ok    ${c.name}\n`);
  }
}

if (failed > 0) {
  process.stderr.write(`\n${failed} case(s) failed\n`);
  process.exit(1);
}
process.stdout.write(`\nAll ${cases.length} cases passed.\n`);
