import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  FocusedInputDeliveryError,
  deliverToFocusedInput,
  parseHelperResult,
  resolveFocusedInputHelperPath,
} from "../src/platform/macos/focusedInputHelper.js";

function writeHelper(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "untype-helper-test-"));
  const path = join(dir, "fake-helper");
  writeFileSync(path, `#!/usr/bin/env node\n${source}`, { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
}

describe("focused input helper adapter", () => {
  it("parses a valid helper success result", () => {
    expect(
      parseHelperResult(
        '{"ok":true,"method":"paste-keycode","clipboard_restored":true}\n',
      ),
    ).toEqual({
      ok: true,
      method: "paste-keycode",
      clipboardRestored: true,
      code: undefined,
      message: undefined,
      targetRole: undefined,
      targetSubrole: undefined,
    });
  });

  it("rejects malformed helper output", () => {
    expect(() => parseHelperResult("not json\n")).toThrow();
    expect(() => parseHelperResult("{}\n")).toThrow();
    expect(() =>
      parseHelperResult('{"ok":true,"method":"unsupported"}\n'),
    ).toThrow();
  });

  it("resolves the helper relative to the compiled platform module", () => {
    const path = resolveFocusedInputHelperPath({
      platform: "darwin",
      moduleUrl: "file:///project/dist/platform/macos/focusedInputHelper.js",
      accessFile: () => {},
    });

    expect(path).toBe("/project/dist/native/macos/untype-input-helper");
  });

  it("fails explicitly when the helper is unavailable", () => {
    expect(() =>
      resolveFocusedInputHelperPath({
        platform: "darwin",
        moduleUrl: "file:///project/dist/platform/macos/focusedInputHelper.js",
        accessFile: () => {
          throw new Error("missing");
        },
      }),
    ).toThrow(FocusedInputDeliveryError);
  });

  it("fails explicitly on unsupported platforms", () => {
    expect(() =>
      resolveFocusedInputHelperPath({
        platform: "linux",
      }),
    ).toThrow(/macOS/);
  });

  it("sends transcript text over stdin and not argv", async () => {
    const helperPath = writeHelper(`
const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  const text = Buffer.concat(chunks).toString("utf8");
  if (process.argv.join(" ").includes(text)) {
    console.log(JSON.stringify({ ok: false, code: "text_in_argv", message: "text leaked to argv" }));
    process.exit(2);
  }
  console.log(JSON.stringify({ ok: true, method: "paste-keycode", clipboard_restored: true }));
});
`);

    await expect(
      deliverToFocusedInput("secret focused text", { helperPath }),
    ).resolves.toMatchObject({
      ok: true,
      method: "paste-keycode",
      clipboardRestored: true,
    });
  });

  it("returns actionable helper failures without throwing for exit code 2", async () => {
    const helperPath = writeHelper(`
process.stdin.resume();
process.stdin.on("end", () => {
  console.error("permission diagnostic without transcript text");
  console.log(JSON.stringify({
    ok: false,
    code: "accessibility_not_trusted",
    message: "Grant Accessibility permission to untype-input-helper."
  }));
  process.exit(2);
});
`);

    await expect(deliverToFocusedInput("hello", { helperPath })).resolves.toEqual({
      ok: false,
      code: "accessibility_not_trusted",
      message: "Grant Accessibility permission to untype-input-helper.",
      method: undefined,
      targetRole: undefined,
      targetSubrole: undefined,
      clipboardRestored: undefined,
    });
  });

  it("rejects invalid helper JSON from the child process", async () => {
    const helperPath = writeHelper(`
process.stdin.resume();
process.stdin.on("end", () => {
  console.log("not json");
});
`);

    await expect(deliverToFocusedInput("hello", { helperPath })).rejects.toThrow(
      FocusedInputDeliveryError,
    );
  });

  it("rejects helper success JSON with a failing exit code", async () => {
    const helperPath = writeHelper(`
process.stdin.resume();
process.stdin.on("end", () => {
  console.log(JSON.stringify({ ok: true, method: "ax-value" }));
  process.exit(1);
});
`);

    await expect(deliverToFocusedInput("hello", { helperPath })).rejects.toThrow(
      FocusedInputDeliveryError,
    );
  });
});
