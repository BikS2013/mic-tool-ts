import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyPersistedProtocolSettings,
  loadPersistedProtocolSettings,
  protocolSettingsPath,
  savePersistedProtocolSettings,
} from "../src/protocol/settingsStore.js";
import type { ProtocolRuntimeConfig } from "../src/protocol/types.js";
import { InvalidConfigurationError } from "../src/errors.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "mic-tool-ts-state-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("protocol settings persistence", () => {
  it("saves and loads non-secret protocol settings", () => {
    savePersistedProtocolSettings(
      {
        operators: { refine: true, translate: false, clipboard: true, input: true },
        translation_policy: "to-en",
      },
      { toolName: "mic-tool-ts", home },
    );

    const path = protocolSettingsPath({ toolName: "mic-tool-ts", home });
    const raw = readFileSync(path, "utf8");
    expect(raw).toContain('"version": 1');
    expect(raw).toContain('"translation_policy": "to-en"');
    expect(raw).not.toContain("API_KEY");

    expect(
      loadPersistedProtocolSettings({ toolName: "mic-tool-ts", home }),
    ).toEqual({
      operators: { refine: true, translate: false, clipboard: true, input: true },
      translation_policy: "to-en",
    });
  });

  it("applies persisted settings only when the matching config value is defaulted", () => {
    const protocol = protocolConfig({
      initialOperators: { refine: false, translate: false, clipboard: false, input: false },
      translationPolicy: "opposite",
      sources: {
        refine: "default",
        translate: "configured",
        clipboard: "default",
        input: "default",
        translationPolicy: "configured",
      },
    });

    const applied = applyPersistedProtocolSettings(protocol, {
      operators: { refine: true, translate: true, clipboard: true, input: true },
      translation_policy: "to-en",
    });

    expect(applied.initialOperators).toEqual({
      refine: true,
      translate: false,
      clipboard: true,
      input: true,
    });
    expect(applied.translationPolicy).toBe("opposite");
  });

  it("returns null when no state file exists", () => {
    expect(
      loadPersistedProtocolSettings({ toolName: "mic-tool-ts", home }),
    ).toBeNull();
  });

  it("raises a typed config error for invalid persisted state", () => {
    const path = protocolSettingsPath({ toolName: "mic-tool-ts", home });
    mkdirSync(join(home, ".tool-agents", "mic-tool-ts"), { recursive: true });
    writeFileSync(path, '{"version":1,"saved_at":"now","protocol":{}}', "utf8");

    expect(() =>
      loadPersistedProtocolSettings({ toolName: "mic-tool-ts", home }),
    ).toThrow(InvalidConfigurationError);
  });

  it("loads old state files without input as input off", () => {
    const path = protocolSettingsPath({ toolName: "mic-tool-ts", home });
    mkdirSync(join(home, ".tool-agents", "mic-tool-ts"), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        saved_at: "2026-05-16T00:00:00.000Z",
        protocol: {
          operators: { refine: true, translate: false, clipboard: true },
          translation_policy: "opposite",
        },
      }),
      "utf8",
    );

    expect(
      loadPersistedProtocolSettings({ toolName: "mic-tool-ts", home }),
    ).toEqual({
      operators: { refine: true, translate: false, clipboard: true, input: false },
      translation_policy: "opposite",
    });
  });
});

function protocolConfig(opts: {
  initialOperators: ProtocolRuntimeConfig["initialOperators"];
  translationPolicy: ProtocolRuntimeConfig["translationPolicy"];
  sources: {
    refine: "configured" | "default";
    translate: "configured" | "default";
    clipboard: "configured" | "default";
    input: "configured" | "default";
    translationPolicy: "configured" | "default";
  };
}): ProtocolRuntimeConfig {
  return {
    interactionMode: "dictation",
    markers: {
      commandPhrase: "command",
      sectionEndPhrase: "command send",
      sectionEndAliases: ["τέλος εντολής"],
      sectionCancelPhrase: "command cancel",
      literalNextPhrase: "literal phrase",
    },
    initialOperators: opts.initialOperators,
    translationPolicy: opts.translationPolicy,
    settingSources: {
      operators: {
        refine: opts.sources.refine,
        translate: opts.sources.translate,
        clipboard: opts.sources.clipboard,
        input: opts.sources.input,
      },
      translationPolicy: opts.sources.translationPolicy,
    },
  };
}
