import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InvalidConfigurationError } from "../src/errors.js";
import {
  loadPersistedUiSettings,
  loadPersistedPushToTalkSettings,
  savePersistedUiSettings,
  savePersistedPushToTalkSettings,
  uiSettingsPath,
} from "../src/ui/settingsStore.js";
import {
  DEFAULT_RENDERER_SETTINGS,
  mergeRendererSettings,
} from "../src/ui/shared.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "mic-tool-ts-ui-store-test-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("UI settings store", () => {
  it("returns null when no UI state file exists", () => {
    expect(loadPersistedUiSettings({ toolName: "mic-tool-ts", home })).toBeNull();
  });

  it("saves and loads all non-secret UI settings with restrictive modes", () => {
    const settings = mergeRendererSettings(
      DEFAULT_RENDERER_SETTINGS,
      {
        provider: "elevenlabs",
        model: "scribe_v2_realtime",
        languages: ["auto"],
        sampleRate: 24000,
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
        apiKeyName: "SHOULD_NOT_BE_STORED",
        apiKeyStatus: "configured",
        expiryStatus: "tomorrow",
        storageStatus: "shell env",
      },
    );

    savePersistedUiSettings(
      settings,
      { toolName: "mic-tool-ts", home },
    );

    const path = uiSettingsPath({ toolName: "mic-tool-ts", home });
    expect(loadPersistedUiSettings({ toolName: "mic-tool-ts", home }))
      .toEqual({
        provider: "elevenlabs",
        model: "scribe_v2_realtime",
        languages: ["auto"],
        sampleRate: 24000,
        endpointDetection: false,
        protocolMode: "agent-protocol",
        refine: true,
        translate: true,
        clipboard: true,
        focusedInput: true,
        translationPolicy: "to-en",
        llmEnabled: false,
        hotkeyEnabled: true,
        hotkey: "CommandOrControl+Shift+Space",
      });
    const file = JSON.parse(readFileSync(path, "utf8"));
    expect(file).toMatchObject({
      version: 1,
      settings: {
        provider: "elevenlabs",
        hotkey: "CommandOrControl+Shift+Space",
      },
      push_to_talk: {
        enabled: true,
        hotkey: "CommandOrControl+Shift+Space",
      },
    });
    expect(JSON.stringify(file)).not.toContain("SHOULD_NOT_BE_STORED");
    expect(JSON.stringify(file)).not.toContain("apiKeyStatus");
    expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("keeps reading push-to-talk-only UI state files", () => {
    const path = uiSettingsPath({ toolName: "mic-tool-ts", home });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        saved_at: "2026-05-20T00:00:00.000Z",
        push_to_talk: {
          enabled: true,
          hotkey: "CmdOrCtrl+Shift+Space",
        },
      }),
      "utf8",
    );

    expect(loadPersistedUiSettings({ toolName: "mic-tool-ts", home })).toEqual({
      hotkeyEnabled: true,
      hotkey: "CommandOrControl+Shift+Space",
    });
    expect(loadPersistedPushToTalkSettings({ toolName: "mic-tool-ts", home }))
      .toEqual({
        enabled: true,
        hotkey: "CommandOrControl+Shift+Space",
      });
  });

  it("keeps the push-to-talk save wrapper compatible", () => {
    savePersistedPushToTalkSettings(
      {
        enabled: true,
        hotkey: "CmdOrCtrl+Shift+Space",
      },
      { toolName: "mic-tool-ts", home },
    );

    expect(loadPersistedPushToTalkSettings({ toolName: "mic-tool-ts", home }))
      .toEqual({
        enabled: true,
        hotkey: "CommandOrControl+Shift+Space",
      });
  });

  it("rejects invalid persisted UI state", () => {
    const path = uiSettingsPath({ toolName: "mic-tool-ts", home });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        saved_at: "2026-05-20T00:00:00.000Z",
        settings: {
          ...mergeRendererSettings(DEFAULT_RENDERER_SETTINGS, {}),
          hotkey: "CommandOrControl+Shift",
        },
      }),
      "utf8",
    );

    expect(() =>
      loadPersistedUiSettings({ toolName: "mic-tool-ts", home }),
    ).toThrow(InvalidConfigurationError);
  });
});
