/// <reference lib="dom" />

export {};

type OverlayPhase =
  | "hidden"
  | "recording"
  | "finalizing"
  | "processed"
  | "warning"
  | "error";

type OverlayTone = "neutral" | "recording" | "success" | "warning" | "error";

interface OverlaySnapshot {
  visible: boolean;
  phase: OverlayPhase;
  tone: OverlayTone;
  label: string;
  detail: string;
  text: string;
  hotkey: string;
  protocolFeatures: ProtocolFeatures;
}

interface ProtocolFeatures {
  refine: boolean;
  translate: boolean;
  clipboard: boolean;
  input: boolean;
}

const shell = mustQuery<HTMLElement>(".overlay-shell");
const label = mustQuery<HTMLElement>("#overlayLabel");
const detail = mustQuery<HTMLElement>("#overlayDetail");
const text = mustQuery<HTMLElement>("#overlayText");
const hotkey = mustQuery<HTMLElement>("#overlayHotkey");
const featureStrip = mustQuery<HTMLElement>("#overlayFeatures");

function mustQuery<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Overlay element not found: ${selector}`);
  }
  return element;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function parseProtocolFeatures(value: unknown): ProtocolFeatures {
  const record = asRecord(value);
  return {
    refine: booleanValue(record?.refine) ?? false,
    translate: booleanValue(record?.translate) ?? false,
    clipboard: booleanValue(record?.clipboard) ?? false,
    input: booleanValue(record?.input) ?? false,
  };
}

function parsePhase(value: unknown): OverlayPhase {
  const normalized = stringValue(value);
  if (
    normalized === "recording" ||
    normalized === "finalizing" ||
    normalized === "processed" ||
    normalized === "warning" ||
    normalized === "error"
  ) {
    return normalized;
  }
  return "hidden";
}

function parseTone(value: unknown): OverlayTone {
  const normalized = stringValue(value);
  if (
    normalized === "recording" ||
    normalized === "success" ||
    normalized === "warning" ||
    normalized === "error"
  ) {
    return normalized;
  }
  return "neutral";
}

function parseSnapshot(value: unknown): OverlaySnapshot | null {
  const record = asRecord(value);
  if (record === null) return null;
  const phase = parsePhase(record.phase);
  const visible = booleanValue(record.visible) ?? phase !== "hidden";
  return {
    visible,
    phase: visible ? phase : "hidden",
    tone: visible ? parseTone(record.tone) : "neutral",
    label: stringValue(record.label) ?? "IDLE",
    detail: stringValue(record.detail) ?? "Idle",
    text: stringValue(record.text) ?? "",
    hotkey: stringValue(record.hotkey) ?? "",
    protocolFeatures: parseProtocolFeatures(record.protocolFeatures),
  };
}

function render(snapshot: OverlaySnapshot): void {
  shell.dataset.phase = snapshot.phase;
  shell.dataset.tone = snapshot.tone;
  shell.dataset.visible = snapshot.visible ? "true" : "false";
  label.textContent = snapshot.label;
  detail.textContent = snapshot.detail;
  text.textContent = snapshot.text;
  hotkey.textContent = snapshot.hotkey;
  hotkey.hidden = snapshot.hotkey.trim().length === 0;
  renderFeatureIndicators(snapshot.protocolFeatures);
}

function renderFeatureIndicators(features: ProtocolFeatures): void {
  const definitions: Array<readonly [keyof ProtocolFeatures, string]> = [
    ["refine", "Refine"],
    ["translate", "Translate"],
    ["clipboard", "Clipboard"],
    ["input", "Input"],
  ];
  featureStrip.replaceChildren(...definitions.map(([key, labelText]) => {
    const item = document.createElement("span");
    item.className = "feature";
    item.dataset.enabled = features[key] ? "true" : "false";
    item.textContent = labelText;
    return item;
  }));
}

if (window.micToolTs === undefined) {
  render({
    visible: true,
    phase: "error",
    tone: "error",
    label: "ERROR",
    detail: "Overlay unavailable",
    text: "Preload bridge did not load.",
    hotkey: "",
    protocolFeatures: {
      refine: false,
      translate: false,
      clipboard: false,
      input: false,
    },
  });
} else {
  const unsubscribe = window.micToolTs.onOverlaySnapshot((rawSnapshot: unknown) => {
    const snapshot = parseSnapshot(rawSnapshot);
    if (snapshot !== null) render(snapshot);
  });

  window.addEventListener("beforeunload", () => {
    if (typeof unsubscribe === "function") unsubscribe();
  });
}
