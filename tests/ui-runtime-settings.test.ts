import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadRendererSettingsForUi,
  refreshCredentialStatus,
} from "../src/ui/runtimeSettings.js";
import {
  DEFAULT_RENDERER_SETTINGS,
  mergeRendererSettings,
} from "../src/ui/shared.js";

const TRACKED_ENV_KEYS = [
  "HOME",
  "SONIOX_API_KEY",
  "ELEVENLABS_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_ENDPOINT",
] as const;

const originalEnv: Record<string, string | undefined> = {};
let tmpDir: string | null = null;
let tmpHome: string | null = null;
let cwdSpy: ReturnType<typeof vi.spyOn> | null = null;

function setCwd(dotenvContents: string): void {
  tmpDir = mkdtempSync(join(tmpdir(), "mic-tool-ts-ui-test-"));
  writeFileSync(join(tmpDir, ".env"), dotenvContents, "utf8");
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
}

beforeEach(() => {
  for (const key of TRACKED_ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
  tmpHome = mkdtempSync(join(tmpdir(), "mic-tool-ts-ui-home-"));
  process.env["HOME"] = tmpHome;
});

afterEach(() => {
  cwdSpy?.mockRestore();
  cwdSpy = null;
  for (const key of TRACKED_ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (tmpDir !== null) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
  if (tmpHome !== null) {
    rmSync(tmpHome, { recursive: true, force: true });
    tmpHome = null;
  }
});

describe("UI runtime settings", () => {
  it("loads renderer settings from the same local .env config chain as the CLI", () => {
    setCwd(
      [
        "SONIOX_API_KEY=sk_configured",
        "MIC_TOOL_TS_REFINE=false",
        "MIC_TOOL_TS_MODEL=stt-custom",
        "MIC_TOOL_TS_LANGUAGES=el,en,fr",
        "MIC_TOOL_TS_SAMPLE_RATE=24000",
        "MIC_TOOL_TS_INPUT_DEFAULT=on",
        "",
      ].join("\n"),
    );

    const result = loadRendererSettingsForUi();

    expect(result.ok).toBe(true);
    expect(result.settings.provider).toBe("soniox");
    expect(result.settings.model).toBe("stt-custom");
    expect(result.settings.languages).toEqual(["el", "en", "fr"]);
    expect(result.settings.sampleRate).toBe(24000);
    expect(result.settings.apiKeyName).toBe("SONIOX_API_KEY");
    expect(result.settings.apiKeyStatus).toBe("configured");
    expect(result.settings.storageStatus).toBe("local .env");
    expect(result.settings.llmEnabled).toBe(false);
    expect(result.settings.focusedInput).toBe(true);
    expect(result.settings.inputStatus).toBe("Ready");
  });

  it("still shows configured Soniox state when strict startup fails on LLM config", () => {
    setCwd("SONIOX_API_KEY=sk_configured\n");

    const result = loadRendererSettingsForUi();

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("AZURE_OPENAI_API_KEY");
    expect(result.settings.apiKeyName).toBe("SONIOX_API_KEY");
    expect(result.settings.apiKeyStatus).toBe("configured");
    expect(result.settings.storageStatus).toBe("local .env");
    expect(result.settings.llmEnabled).toBe(true);
  });

  it("refreshes credential status when the UI switches provider", () => {
    setCwd("SONIOX_API_KEY=sk_configured\nMIC_TOOL_TS_REFINE=false\n");
    const elevenlabsSettings = mergeRendererSettings(DEFAULT_RENDERER_SETTINGS, {
      provider: "elevenlabs",
      model: "scribe_v2_realtime",
      languages: ["auto"],
    });

    const refreshed = refreshCredentialStatus(elevenlabsSettings);

    expect(refreshed.apiKeyName).toBe("ELEVENLABS_API_KEY");
    expect(refreshed.apiKeyStatus).toBe("missing");
    expect(refreshed.storageStatus).toBe("not found");
  });
});
