import { describe, expect, it } from "vitest";

import {
  eventMatchesHotkey,
  eventReleasesHotkey,
  parseHotkeyAccelerator,
} from "../src/ui/hotkey.js";

describe("UI hotkey parsing", () => {
  it("uses Command+apostrophe as the default-friendly canonical form", () => {
    expect(parseHotkeyAccelerator("Command+'")).toMatchObject({
      accelerator: "Command+'",
      meta: true,
      key: "'",
    });
    expect(parseHotkeyAccelerator("Command-'").accelerator).toBe("Command+'");
    expect(parseHotkeyAccelerator("Command+Quote").accelerator).toBe("Command+'");
    expect(parseHotkeyAccelerator("Command+Apostrophe").accelerator).toBe("Command+'");
  });

  it("normalizes accelerator aliases", () => {
    expect(parseHotkeyAccelerator("CmdOrCtrl + Shift + Space")).toMatchObject({
      accelerator: "CommandOrControl+Shift+Space",
      commandOrControl: true,
      shift: true,
      key: "Space",
    });
  });

  it("matches CommandOrControl against the platform modifier", () => {
    const hotkey = parseHotkeyAccelerator("CommandOrControl+Shift+Space");

    expect(eventMatchesHotkey({
      key: " ",
      code: "Space",
      ctrlKey: false,
      metaKey: true,
      altKey: false,
      shiftKey: true,
    }, hotkey, true)).toBe(true);

    expect(eventMatchesHotkey({
      key: " ",
      code: "Space",
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: true,
    }, hotkey, false)).toBe(true);
  });

  it("allows CommandOrControl to use Control on macOS for UI push-to-talk", () => {
    const hotkey = parseHotkeyAccelerator("CommandOrControl+Shift+Space");

    expect(eventMatchesHotkey({
      key: " ",
      code: "Space",
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: true,
    }, hotkey, true)).toBe(true);
  });

  it("detects release of either the main key or a required modifier", () => {
    const hotkey = parseHotkeyAccelerator("CommandOrControl+Shift+Space");

    expect(eventReleasesHotkey({
      key: "Shift",
      code: "ShiftLeft",
      ctrlKey: false,
      metaKey: true,
      altKey: false,
      shiftKey: false,
    }, hotkey, true)).toBe(true);
  });
});
