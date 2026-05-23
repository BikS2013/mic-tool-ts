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
  settingsToSessionArgs,
} from "../src/ui/shared.js";
import { savePersistedUiSettings } from "../src/ui/settingsStore.js";

const TRACKED_ENV_KEYS = [
  "HOME",
  "SONIOX_API_KEY",
  "ELEVENLABS_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_ENDPOINT",
  "UNTYPE_LLM_PROVIDER",
  "UNTYPE_LLM_MODEL",
  "GOOGLE_API_KEY",
] as const;

const originalEnv: Record<string, string | undefined> = {};
let tmpDir: string | null = null;
let tmpHome: string | null = null;
let cwdSpy: ReturnType<typeof vi.spyOn> | null = null;

function setCwd(dotenvContents: string): void {
  tmpDir = mkdtempSync(join(tmpdir(), "untype-ui-test-"));
  writeFileSync(join(tmpDir, ".env"), dotenvContents, "utf8");
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
}

beforeEach(() => {
  for (const key of TRACKED_ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
  tmpHome = mkdtempSync(join(tmpdir(), "untype-ui-home-"));
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
        "UNTYPE_REFINE=false",
        "UNTYPE_LLM_PROVIDER=litellm",
        "UNTYPE_LLM_MODEL=local-refiner",
        "UNTYPE_MODEL=stt-custom",
        "UNTYPE_LANGUAGES=el,en,fr",
        "UNTYPE_SAMPLE_RATE=24000",
        "UNTYPE_INPUT_DEFAULT=on",
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
    expect(result.settings.llmProvider).toBe("litellm");
    expect(result.settings.llmModel).toBe("local-refiner");
    expect(result.settings.focusedInput).toBe(true);
    expect(result.settings.inputStatus).toBe("Ready");
  });

  it("restores persisted UI settings on UI load", () => {
    setCwd("SONIOX_API_KEY=sk_configured\nELEVENLABS_API_KEY=xi_configured\nUNTYPE_REFINE=false\n");
    savePersistedUiSettings(
      mergeRendererSettings(DEFAULT_RENDERER_SETTINGS, {
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
        llmProvider: "openai",
        llmModel: "gpt-5.4-mini",
        hotkeyEnabled: true,
        hotkey: "CmdOrCtrl+Shift+Space",
      }),
      { toolName: "untype", home: tmpHome ?? undefined },
    );

    const result = loadRendererSettingsForUi();

    expect(result.ok).toBe(true);
    expect(result.settings.provider).toBe("elevenlabs");
    expect(result.settings.model).toBe("scribe_v2_realtime");
    expect(result.settings.languages).toEqual(["auto"]);
    expect(result.settings.sampleRate).toBe(24000);
    expect(result.settings.endpointDetection).toBe(false);
    expect(result.settings.protocolMode).toBe("agent-protocol");
    expect(result.settings.refine).toBe(true);
    expect(result.settings.translate).toBe(true);
    expect(result.settings.clipboard).toBe(true);
    expect(result.settings.focusedInput).toBe(true);
    expect(result.settings.translationPolicy).toBe("to-en");
    expect(result.settings.llmEnabled).toBe(false);
    expect(result.settings.llmProvider).toBe("openai");
    expect(result.settings.llmModel).toBe("gpt-5.4-mini");
    expect(result.settings.hotkeyEnabled).toBe(true);
    expect(result.settings.hotkey).toBe("CommandOrControl+Shift+Space");
    expect(result.settings.apiKeyName).toBe("ELEVENLABS_API_KEY");
    expect(result.settings.apiKeyStatus).toBe("configured");
    expect(result.settings.storageStatus).toBe("local .env");
  });

  it("validates persisted Google LLM settings instead of default Azure settings on UI load", () => {
    setCwd("SONIOX_API_KEY=sk_configured\nGOOGLE_API_KEY=google-key\n");
    savePersistedUiSettings(
      mergeRendererSettings(DEFAULT_RENDERER_SETTINGS, {
        llmProvider: "google",
        llmModel: "gemini-3.5-flash",
      }),
      { toolName: "untype", home: tmpHome ?? undefined },
    );

    const result = loadRendererSettingsForUi();

    expect(result.ok).toBe(true);
    expect(result.settings.llmEnabled).toBe(true);
    expect(result.settings.llmProvider).toBe("google");
    expect(result.settings.llmModel).toBe("gemini-3.5-flash");
  });

  it("reports invalid persisted UI settings as a UI settings error", () => {
    setCwd("SONIOX_API_KEY=sk_configured\nUNTYPE_REFINE=false\n");
    const statePath = join(
      tmpHome ?? "",
      ".tool-agents",
      "untype",
      "ui-state.json",
    );
    savePersistedUiSettings(
      mergeRendererSettings(DEFAULT_RENDERER_SETTINGS, {}),
      { toolName: "untype", home: tmpHome ?? undefined },
    );
    writeFileSync(
      statePath,
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

    const result = loadRendererSettingsForUi();

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("invalid_configuration");
    expect(result.error?.message).toContain("Invalid UI settings state");
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
    expect(result.settings.llmProvider).toBe("azure-openai");
    expect(result.settings.llmModel).toBe("gpt-5.4");
  });

  it("refreshes credential status when the UI switches provider", () => {
    setCwd("SONIOX_API_KEY=sk_configured\nUNTYPE_REFINE=false\n");
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

  it("passes selected LLM provider and model to UI-started sessions", () => {
    const args = settingsToSessionArgs(mergeRendererSettings(DEFAULT_RENDERER_SETTINGS, {
      llmProvider: "openai",
      llmModel: "gpt-5.4-mini",
    }));

    expect(args).toContain("--llm-provider");
    expect(args).toContain("openai");
    expect(args).toContain("--llm-model");
    expect(args).toContain("gpt-5.4-mini");
  });
});
