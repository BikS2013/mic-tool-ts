import { describe, expect, it } from "vitest";

import {
  DEFAULT_RENDERER_SETTINGS,
  mergeRendererSettings,
  settingsToSessionArgs,
} from "../src/ui/shared.js";

describe("Electron UI settings", () => {
  it("defaults push-to-talk to Command+apostrophe", () => {
    expect(DEFAULT_RENDERER_SETTINGS.hotkey).toBe("Command+'");
  });

  it("builds explicit session args from renderer settings", () => {
    const settings = mergeRendererSettings(DEFAULT_RENDERER_SETTINGS, {
      provider: "elevenlabs",
      model: "scribe_v2_realtime",
      languages: ["auto"],
      endpointDetection: false,
      protocolMode: "agent-protocol",
      refine: true,
      translate: true,
      clipboard: true,
      focusedInput: true,
      translationPolicy: "to-en",
      llmEnabled: false,
      hotkeyEnabled: true,
      hotkey: "CmdOrCtrl+Shift+Space",
    });

    expect(settings.hotkey).toBe("CommandOrControl+Shift+Space");

    expect(settingsToSessionArgs(settings)).toEqual([
      "--stt-provider",
      "elevenlabs",
      "--model",
      "scribe_v2_realtime",
      "--sample-rate",
      "16000",
      "--no-endpoint-detection",
      "--interaction-mode",
      "agent-protocol",
      "--refine-default",
      "on",
      "--translate-default",
      "on",
      "--clipboard-default",
      "on",
      "--input-default",
      "on",
      "--translation-policy",
      "to-en",
      "--no-refine",
      "--language",
      "auto",
    ]);
  });

  it("rejects invalid renderer settings before starting a session", () => {
    expect(() =>
      mergeRendererSettings(DEFAULT_RENDERER_SETTINGS, {
        provider: "other",
      }),
    ).toThrow("Unsupported STT provider");

    expect(() =>
      mergeRendererSettings(DEFAULT_RENDERER_SETTINGS, {
        languages: [],
      }),
    ).toThrow("At least one language hint is required");

    expect(() =>
      mergeRendererSettings(DEFAULT_RENDERER_SETTINGS, {
        hotkey: "CommandOrControl+Shift",
      }),
    ).toThrow("Hotkey must include a non-modifier key");
  });
});
