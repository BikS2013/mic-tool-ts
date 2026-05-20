/// <reference lib="dom" />

import {
  eventMatchesHotkey,
  eventReleasesHotkey,
  normalizeHotkeyAccelerator,
  parseHotkeyAccelerator,
  type ParsedHotkey,
} from "../hotkey.js";

export {};

type SessionState = "idle" | "loading" | "running" | "stopping" | "error";
type ViewName = "monitor" | "settings" | "protocol" | "logs";

interface RendererSettings {
  provider: string;
  model: string;
  languages: string[];
  sampleRate: number;
  endpointDetection: boolean;
  protocolMode: string;
  refine: boolean;
  translate: boolean;
  clipboard: boolean;
  focusedInput: boolean;
  translationPolicy: string;
  llmEnabled: boolean;
  apiKeyName: string;
  apiKeyStatus: string;
  expiryStatus: string;
  storageStatus: string;
  inputStatus: string;
  hotkeyEnabled: boolean;
  hotkey: string;
}

interface UiSettingsLoadResult {
  ok: boolean;
  settings: Partial<RendererSettings>;
  error?: {
    code: string;
    message: string;
    exitCode: number;
  };
}

type SessionEvent =
  | { type: "session.ready"; message: string }
  | { type: "session.state"; state: "idle" | "starting" | "listening" | "stopping" | "stopped" | "error"; reason?: string }
  | { type: "session.started" }
  | { type: "session.stopping" }
  | { type: "session.stopped" }
  | { type: "session.error"; message: string }
  | { type: "transcript.partial"; text: string; language?: string }
  | { type: "transcript.final"; text: string; language?: string; source?: string }
  | { type: "transcript.refined"; text: string; target?: string }
  | { type: "transcript.turnBoundary" }
  | { type: "protocol.event"; message: string; status?: string; eventType?: string }
  | { type: "protocol.status"; message: string; status?: string; eventType?: string }
  | { type: "diagnostic.warning"; message: string }
  | { type: "diagnostic.info"; message: string }
  | { type: "audio.level"; level: number }
  | { type: "config.loaded"; settings?: Partial<RendererSettings>; summary?: string }
  | { type: "config.saved"; message?: string };

interface MicToolTsApi {
  loadSettings(): Promise<unknown>;
  updateSettings(settings: Partial<RendererSettings>): Promise<unknown>;
  startSession(): Promise<unknown>;
  stopSession(options?: { submitPending?: boolean }): Promise<unknown>;
  onSessionEvent(callback: (event: unknown) => void): void | (() => void);
}

declare global {
  interface Window {
    micToolTs?: MicToolTsApi;
  }
}

interface TranscriptItem {
  id: number;
  kind: "final" | "processed" | "partial" | "error";
  time: string;
  label: string;
  status: string;
  text: string;
}

interface LogItem {
  id: number;
  label: string;
  detail: string;
  time: string;
}

const defaultSettings: RendererSettings = {
  provider: "soniox",
  model: "stt-rt-v4",
  languages: ["el", "en"],
  sampleRate: 16000,
  endpointDetection: true,
  protocolMode: "dictation",
  refine: false,
  translate: false,
  clipboard: false,
  focusedInput: false,
  translationPolicy: "opposite",
  llmEnabled: true,
  apiKeyName: "SONIOX_API_KEY",
  apiKeyStatus: "unknown",
  expiryStatus: "not set",
  storageStatus: "resolved config",
  inputStatus: "Off",
  hotkeyEnabled: false,
  hotkey: "Command+'",
};

const demoTranscript: TranscriptItem[] = [
  {
    id: 1,
    kind: "final",
    time: "22:58:10",
    label: "Final transcript",
    status: "el",
    text: "Open the settings file and check whether the Soniox API key is active.",
  },
  {
    id: 2,
    kind: "processed",
    time: "22:58:13",
    label: "Processed section",
    status: "input sent",
    text: "Open the configuration file and verify that the Soniox API key is still valid.",
  },
  {
    id: 3,
    kind: "final",
    time: "22:58:18",
    label: "Final transcript",
    status: "en",
    text: "Now switch the provider to ElevenLabs, but keep endpoint detection enabled.",
  },
  {
    id: 4,
    kind: "partial",
    time: "Live",
    label: "Partial transcript",
    status: "streaming",
    text: "and show me the current command status before sending...",
  },
];

const demoEvents: LogItem[] = [
  { id: 1, label: "Session ready", detail: "demo renderer active", time: "now" },
  { id: 2, label: "Endpoint boundary", detail: "turn committed", time: "12 s" },
  { id: 3, label: "Input sent", detail: "focused input delivery", time: "18 s" },
];

const demoPartials = [
  "listening for the next command...",
  "show me the current command status...",
  "show me the current command status before sending...",
  "and keep endpoint detection enabled...",
];

const state = {
  current: "loading" as SessionState,
  view: "monitor" as ViewName,
  demoMode: false,
  settings: { ...defaultSettings },
  transcript: [] as TranscriptItem[],
  events: [] as LogItem[],
  partialId: 0,
  nextId: 1,
  demoTimer: 0,
  hotkeyPressed: false,
  hotkeySessionActive: false,
};

const appShell = mustQuery<HTMLElement>(".app-shell");
const sessionSummary = mustQuery<HTMLElement>("#sessionSummary");
const sessionStatusText = mustQuery<HTMLElement>("#sessionStatusText");
const timeline = mustQuery<HTMLElement>("#timeline");
const settingsList = mustQuery<HTMLElement>("#settingsList");
const protocolList = mustQuery<HTMLElement>("#protocolList");
const eventList = mustQuery<HTMLElement>("#eventList");
const recentEvents = mustQuery<HTMLElement>("#recentEvents");
const liveText = mustQuery<HTMLElement>("#liveText");
const sessionToggle = mustQuery<HTMLButtonElement>("#sessionToggle");
const transcriptCount = mustQuery<HTMLElement>("#transcriptCount");
const eventCount = mustQuery<HTMLElement>("#eventCount");
const demoPill = mustQuery<HTMLElement>("#demoPill");
const providerControl = mustQuery<HTMLSelectElement>("#providerControl");
const modelControl = mustQuery<HTMLInputElement>("#modelControl");
const languagesControl = mustQuery<HTMLInputElement>("#languagesControl");
const sampleRateControl = mustQuery<HTMLSelectElement>("#sampleRateControl");
const endpointControl = mustQuery<HTMLInputElement>("#endpointControl");
const hotkeyEnabledControl = mustQuery<HTMLInputElement>("#hotkeyEnabledControl");
const hotkeyControl = mustQuery<HTMLInputElement>("#hotkeyControl");
const protocolModeControl = mustQuery<HTMLSelectElement>("#protocolModeControl");
const refineControl = mustQuery<HTMLInputElement>("#refineControl");
const translateControl = mustQuery<HTMLInputElement>("#translateControl");
const clipboardControl = mustQuery<HTMLInputElement>("#clipboardControl");
const focusedInputControl = mustQuery<HTMLInputElement>("#focusedInputControl");
const translationPolicyControl = mustQuery<HTMLSelectElement>("#translationPolicyControl");
const llmEnabledControl = mustQuery<HTMLInputElement>("#llmEnabledControl");

function mustQuery<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Renderer element not found: ${selector}`);
  }
  return element;
}

function setText(selector: string, value: string): void {
  mustQuery<HTMLElement>(selector).textContent = value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArrayValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  return strings.length > 0 ? strings : undefined;
}

function parseSettings(value: unknown): Partial<RendererSettings> {
  const record = asRecord(value);
  if (record === null) return {};

  const settings: Partial<RendererSettings> = {};
  settings.provider = stringValue(record.provider);
  settings.model = stringValue(record.model);
  settings.languages = stringArrayValue(record.languages);
  settings.sampleRate = numberValue(record.sampleRate);
  settings.endpointDetection = booleanValue(record.endpointDetection);
  settings.protocolMode = stringValue(record.protocolMode);
  settings.refine = booleanValue(record.refine);
  settings.translate = booleanValue(record.translate);
  settings.clipboard = booleanValue(record.clipboard);
  settings.focusedInput = booleanValue(record.focusedInput);
  settings.translationPolicy = stringValue(record.translationPolicy);
  settings.llmEnabled = booleanValue(record.llmEnabled);
  settings.apiKeyName = stringValue(record.apiKeyName);
  settings.apiKeyStatus = stringValue(record.apiKeyStatus);
  settings.expiryStatus = stringValue(record.expiryStatus);
  settings.storageStatus = stringValue(record.storageStatus);
  settings.inputStatus = stringValue(record.inputStatus);
  settings.hotkeyEnabled = booleanValue(record.hotkeyEnabled);
  settings.hotkey = stringValue(record.hotkey);
  return settings;
}

function parseSettingsFromSafeConfig(value: unknown): Partial<RendererSettings> {
  const record = asRecord(value);
  if (record === null) return {};

  const operators = asRecord(record.operators);
  const sttProvider = stringValue(record.sttProvider);
  const languages = stringArrayValue(record.languages);
  const sampleRate = numberValue(record.sampleRate);
  const endpointDetection = booleanValue(record.enableEndpointDetection);
  const interactionMode = stringValue(record.interactionMode);
  const apiKeyEnvName = stringValue(record.apiKeyEnvName);
  const apiKeyConfigured = booleanValue(record.apiKeyConfigured);
  const apiKeySource = stringValue(record.apiKeySource);
  const inputEnabled = booleanValue(operators?.input);

  return {
    provider: sttProvider,
    model: stringValue(record.model),
    languages,
    sampleRate,
    endpointDetection,
    protocolMode: interactionMode,
    refine: booleanValue(operators?.refine),
    translate: booleanValue(operators?.translate),
    clipboard: booleanValue(operators?.clipboard),
    focusedInput: inputEnabled,
    translationPolicy: stringValue(record.translationPolicy),
    llmEnabled: booleanValue(record.llmEnabled),
    apiKeyName: apiKeyEnvName,
    apiKeyStatus: apiKeyConfigured === undefined
      ? undefined
      : apiKeyConfigured ? "configured" : "missing",
    expiryStatus: stringValue(record.apiKeyExpiresAt) ?? "not set",
    storageStatus: sourceLabel(apiKeySource) ?? "resolved config",
    inputStatus: inputEnabled === undefined
      ? undefined
      : inputEnabled ? "Ready" : "Off",
  };
}

function parseSettingsLoadResult(value: unknown): UiSettingsLoadResult {
  const record = asRecord(value);
  if (record === null || !("settings" in record)) {
    return {
      ok: true,
      settings: parseSettings(value),
    };
  }

  const errorRecord = asRecord(record.error);
  const message = stringValue(errorRecord?.message);
  const code = stringValue(errorRecord?.code);
  const exitCode = numberValue(errorRecord?.exitCode);

  return {
    ok: booleanValue(record.ok) ?? false,
    settings: parseSettings(record.settings),
    error: message === undefined
      ? undefined
      : {
          code: code ?? "UNKNOWN",
          message,
          exitCode: exitCode ?? 1,
        },
  };
}

function sourceLabel(source: string | undefined): string | undefined {
  switch (source) {
    case "flag":
      return "CLI flag";
    case ".env":
      return "local .env";
    case "user":
      return "user .env";
    case "env":
      return "shell env";
    default:
      return undefined;
  }
}

function parseEvent(value: unknown): SessionEvent | null {
  const record = asRecord(value);
  if (record === null) return null;

  const type = stringValue(record.type);
  if (type === undefined) return null;

  switch (type) {
    case "session.ready":
      return {
        type,
        message: stringValue(record.message) ?? "Session ready",
      };
    case "session.state": {
      const stateValue = stringValue(record.state);
      if (
        stateValue !== "idle" &&
        stateValue !== "starting" &&
        stateValue !== "listening" &&
        stateValue !== "stopping" &&
        stateValue !== "stopped" &&
        stateValue !== "error"
      ) {
        return null;
      }
      return {
        type,
        state: stateValue,
        reason: stringValue(record.reason),
      };
    }
    case "session.started":
    case "session.stopping":
    case "session.stopped":
    case "transcript.turnBoundary":
      return { type };
    case "session.error":
      return { type, message: stringValue(record.message) ?? "Session error" };
    case "transcript.partial":
      return {
        type,
        text: stringValue(record.text) ?? "",
        language: stringValue(record.language),
      };
    case "transcript.final":
      return {
        type,
        text: stringValue(record.text) ?? "",
        language: stringValue(record.language),
        source: stringValue(record.source),
      };
    case "transcript.refined":
      return {
        type,
        text: stringValue(record.text) ?? "",
        target: stringValue(record.target),
      };
    case "protocol.event":
    case "protocol.status": {
      const protocolEvent = asRecord(record.event);
      const eventType = stringValue(protocolEvent?.type);
      return {
        type,
        message: stringValue(record.message) ?? eventType ?? type,
        status: stringValue(record.status),
        eventType,
      };
    }
    case "diagnostic.warning":
    case "diagnostic.info":
      return { type, message: stringValue(record.message) ?? type };
    case "audio.level":
      return { type, level: numberValue(record.level) ?? 0 };
    case "config.loaded":
      return {
        type,
        settings: {
          ...parseSettings(record.settings),
          ...parseSettingsFromSafeConfig(record.config),
        },
      };
    case "config.saved":
      return { type, message: stringValue(record.message) };
    default:
      return null;
  }
}

function titleCase(value: string): string {
  return value
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function mergeSettings(settings: Partial<RendererSettings>): void {
  state.settings = { ...state.settings, ...settings };
}

function formatSummary(settings: RendererSettings): string {
  return `${displayProvider(settings.provider)} - ${settings.model} - ${settings.languages.join(" + ")} - ${Math.round(settings.sampleRate / 1000)} kHz`;
}

function setSessionState(nextState: SessionState): void {
  state.current = nextState;
  appShell.dataset.state = nextState;

  const labelByState: Record<SessionState, string> = {
    idle: "Idle",
    loading: "Loading",
    running: "Listening",
    stopping: "Stopping",
    error: "Needs attention",
  };
  sessionStatusText.textContent = labelByState[nextState];
  sessionToggle.textContent =
    nextState === "running" || nextState === "stopping"
      ? "Stop Listening"
      : "Start Listening";
  sessionToggle.disabled = nextState === "loading" || nextState === "stopping";
  updateControlDisabledState();
}

function setSwitch(selector: string, enabled: boolean): void {
  const element = mustQuery<HTMLElement>(selector);
  element.classList.toggle("off", !enabled);
  element.setAttribute("aria-checked", String(enabled));
}

function renderSettings(): void {
  const settings = state.settings;
  const providerLabel = displayProvider(settings.provider);
  sessionSummary.textContent = formatSummary(settings);
  setText("#providerValue", providerLabel);
  setText("#modeValue", settings.protocolMode);
  setText("#inputValue", settings.inputStatus);
  setText("#inspectorProvider", providerLabel);
  setText("#inspectorModel", settings.model);
  setText("#inspectorLanguages", settings.languages.join(", "));
  setText("#inspectorMode", settings.protocolMode);
  setText("#apiKeyName", settings.apiKeyName);
  setText("#apiKeyStatus", settings.apiKeyStatus);
  setText("#expiryStatus", settings.expiryStatus);
  setText("#storageStatus", settings.storageStatus);
  setSwitch("#endpointSwitch", settings.endpointDetection);
  setSwitch("#refineSwitch", settings.refine);
  setSwitch("#translateSwitch", settings.translate);
  setSwitch("#clipboardSwitch", settings.clipboard);
  setSwitch("#focusedInputSwitch", settings.focusedInput);
  syncControls(settings);

  settingsList.replaceChildren(
    listRow("Provider", providerLabel),
    listRow("Model", settings.model),
    listRow("Languages", settings.languages.join(", ")),
    listRow("Sample rate", `${settings.sampleRate} Hz`),
    listRow("Endpoint detection", settings.endpointDetection ? "on" : "off"),
    listRow("Push-to-talk", settings.hotkeyEnabled ? settings.hotkey : "off"),
    listRow(settings.apiKeyName, settings.apiKeyStatus),
    listRow("Expiry", settings.expiryStatus),
  );

  protocolList.replaceChildren(
    listRow("Mode", settings.protocolMode),
    listRow("Refine", settings.refine ? "on" : "off"),
    listRow("Translate", settings.translate ? "on" : "off"),
    listRow("Clipboard", settings.clipboard ? "on" : "off"),
    listRow("Focused input", settings.focusedInput ? "on" : "off"),
    listRow("Translation policy", settings.translationPolicy),
    listRow("LLM engine", settings.llmEnabled ? "on" : "off"),
  );
}

function displayProvider(provider: string): string {
  return provider.trim().toLowerCase() === "elevenlabs" ? "ElevenLabs" : "Soniox";
}

function syncControls(settings: RendererSettings): void {
  providerControl.value = normalizeProvider(settings.provider);
  modelControl.value = settings.model;
  languagesControl.value = settings.languages.join(", ");
  sampleRateControl.value = String(settings.sampleRate);
  endpointControl.checked = settings.endpointDetection;
  hotkeyEnabledControl.checked = settings.hotkeyEnabled;
  hotkeyControl.value = settings.hotkey;
  protocolModeControl.value = settings.protocolMode;
  refineControl.checked = settings.refine;
  translateControl.checked = settings.translate;
  clipboardControl.checked = settings.clipboard;
  focusedInputControl.checked = settings.focusedInput;
  translationPolicyControl.value = settings.translationPolicy;
  llmEnabledControl.checked = settings.llmEnabled;
  updateControlDisabledState();
}

function listRow(label: string, value: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "list-row";

  const labelNode = document.createElement("span");
  labelNode.textContent = label;

  const valueNode = document.createElement("strong");
  valueNode.textContent = value;

  row.append(labelNode, valueNode);
  return row;
}

function collectSettingsFromControls(): Partial<RendererSettings> {
  return {
    provider: normalizeProvider(providerControl.value),
    model: modelControl.value.trim(),
    languages: parseLanguages(languagesControl.value),
    sampleRate: Number.parseInt(sampleRateControl.value, 10),
    endpointDetection: endpointControl.checked,
    hotkeyEnabled: hotkeyEnabledControl.checked,
    hotkey: normalizeHotkeyAccelerator(hotkeyControl.value),
    protocolMode: protocolModeControl.value,
    refine: refineControl.checked,
    translate: translateControl.checked,
    clipboard: clipboardControl.checked,
    focusedInput: focusedInputControl.checked,
    translationPolicy: translationPolicyControl.value,
    llmEnabled: llmEnabledControl.checked,
  };
}

function parseLanguages(value: string): string[] {
  const languages = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return languages.length > 0 ? languages : [...state.settings.languages];
}

function normalizeProvider(value: string): string {
  return value.trim().toLowerCase() === "elevenlabs" ? "elevenlabs" : "soniox";
}

function mergeSettingsFromControls(): void {
  let next: Partial<RendererSettings>;
  try {
    next = collectSettingsFromControls();
  } catch (error) {
    addEvent("Settings error", errorMessage(error));
    renderSettings();
    return;
  }
  const providerChanged = next.provider !== state.settings.provider;
  if (providerChanged && next.provider === "elevenlabs") {
    next.model = "scribe_v2_realtime";
    next.languages = ["auto"];
  } else if (providerChanged && next.provider === "soniox") {
    next.model = "stt-rt-v4";
    next.languages = ["el", "en"];
  }
  mergeSettings(next);
  renderSettings();
  void persistSettings(next);
}

async function persistSettings(patch: Partial<RendererSettings>): Promise<void> {
  if (state.demoMode || window.micToolTs === undefined) {
    addEvent("Settings unavailable", "preload bridge unavailable");
    return;
  }
  try {
    const updated = await window.micToolTs.updateSettings(patch);
    mergeSettings(parseSettings(updated));
    renderSettings();
  } catch (error) {
    addEvent("Settings error", errorMessage(error));
  }
}

function updateControlDisabledState(): void {
  const disabled = state.current === "running" || state.current === "loading" || state.current === "stopping";
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(
    "[data-setting-control], [data-setting-toggle]",
  ).forEach((control) => {
    control.disabled = disabled;
  });
}

function renderTranscript(): void {
  timeline.replaceChildren(...state.transcript.map(transcriptRow));
  transcriptCount.textContent = String(
    state.transcript.filter((item) => item.kind !== "partial").length,
  );
  const partial = state.transcript.find((item) => item.kind === "partial");
  liveText.textContent = partial?.text ?? "Waiting for audio...";
  timeline.scrollTop = timeline.scrollHeight;
}

function transcriptRow(item: TranscriptItem): HTMLElement {
  const row = document.createElement("article");
  row.className = "transcript-row";

  const time = document.createElement("div");
  time.className = "time";
  time.textContent = item.time;

  const bubble = document.createElement("div");
  bubble.className = `bubble ${item.kind === "final" ? "" : item.kind}`.trim();

  const meta = document.createElement("div");
  meta.className = "meta";

  const label = document.createElement("span");
  label.textContent = item.label;

  const status = document.createElement("span");
  status.textContent = item.status;

  const text = document.createElement("div");
  text.className = "text";
  text.textContent = item.text;

  meta.append(label, status);
  bubble.append(meta, text);
  row.append(time, bubble);
  return row;
}

function renderEvents(): void {
  const rows = state.events.map(eventRow);
  eventList.replaceChildren(...rows);
  recentEvents.replaceChildren(...state.events.slice(-4).map(eventRow));
  eventCount.textContent = String(state.events.length);
}

function eventRow(item: LogItem): HTMLElement {
  const row = document.createElement("div");
  row.className = "event-row";

  const labelWrap = document.createElement("span");
  labelWrap.textContent = `${item.label}: ${item.detail}`;

  const time = document.createElement("strong");
  time.textContent = item.time;

  row.append(labelWrap, time);
  return row;
}

function addEvent(label: string, detail: string): void {
  state.events.push({
    id: state.nextId,
    label,
    detail,
    time: shortTime(),
  });
  state.nextId += 1;
  renderEvents();
}

function shortTime(): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}

function setActiveView(view: ViewName): void {
  state.view = view;
  const panelByView: Record<ViewName, string> = {
    monitor: "#monitorView",
    settings: "#settingsView",
    protocol: "#protocolView",
    logs: "#logsView",
  };

  document.querySelectorAll<HTMLElement>(".view-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.matches(panelByView[view]));
  });

  document.querySelectorAll<HTMLElement>("[data-view-button]").forEach((button) => {
    button.classList.toggle("active", button.dataset.viewButton === view);
    button.classList.toggle("selected", button.dataset.viewButton === view);
  });
}

function updatePartial(text: string, language?: string): void {
  const existing = state.transcript.find((item) => item.kind === "partial");
  if (existing !== undefined) {
    existing.text = text;
    existing.status = language ?? "streaming";
    existing.time = "Live";
  } else {
    state.partialId = state.nextId;
    state.nextId += 1;
    state.transcript.push({
      id: state.partialId,
      kind: "partial",
      time: "Live",
      label: "Partial transcript",
      status: language ?? "streaming",
      text,
    });
  }
  renderTranscript();
}

function commitTranscript(kind: "final" | "processed" | "error", text: string, status: string): void {
  state.transcript = state.transcript.filter((item) => item.kind !== "partial");
  state.transcript.push({
    id: state.nextId,
    kind,
    time: shortTime(),
    label:
      kind === "processed"
        ? "Processed section"
        : kind === "error"
          ? "Session issue"
          : "Final transcript",
    status,
    text,
  });
  state.nextId += 1;
  renderTranscript();
}

function handleEvent(event: SessionEvent): void {
  switch (event.type) {
    case "session.ready":
      setSessionState("running");
      sessionSummary.textContent = event.message.replace(/^\[mic-tool-ts\]\s*/, "");
      addEvent("Session ready", "settings loaded");
      return;
    case "session.state":
      if (event.state === "starting") setSessionState("loading");
      else if (event.state === "listening") setSessionState("running");
      else if (event.state === "stopping") setSessionState("stopping");
      else if (event.state === "stopped" || event.state === "idle") setSessionState("idle");
      else setSessionState("error");
      addEvent("State", event.reason ?? event.state);
      return;
    case "session.started":
      setSessionState("running");
      addEvent("Session started", "microphone stream active");
      return;
    case "session.stopping":
      setSessionState("stopping");
      addEvent("Session stopping", "closing streams");
      return;
    case "session.stopped":
      state.hotkeySessionActive = false;
      state.hotkeyPressed = false;
      setSessionState("idle");
      addEvent("Session stopped", "ready");
      return;
    case "session.error":
      state.hotkeySessionActive = false;
      state.hotkeyPressed = false;
      setSessionState("error");
      commitTranscript("error", event.message, "error");
      addEvent("Error", event.message);
      return;
    case "transcript.partial":
      updatePartial(event.text, event.language);
      return;
    case "transcript.final":
      commitTranscript("final", event.text, event.language ?? event.source ?? "final");
      return;
    case "transcript.refined":
      commitTranscript("processed", event.text, event.target ?? "processed");
      addEvent("Processed section", event.target ?? "ready");
      return;
    case "transcript.turnBoundary":
      addEvent("Turn boundary", "committed");
      return;
    case "protocol.event":
    case "protocol.status":
      addEvent("Protocol", event.status ?? event.eventType ?? event.message);
      return;
    case "diagnostic.warning":
      addEvent("Warning", event.message);
      return;
    case "diagnostic.info":
      addEvent("Info", event.message);
      return;
    case "audio.level":
      appShell.style.setProperty("--audio-level", String(event.level));
      return;
    case "config.loaded":
      mergeSettings(event.settings ?? {});
      renderSettings();
      addEvent("Config loaded", "settings refreshed");
      return;
    case "config.saved":
      addEvent("Config saved", event.message ?? "settings persisted");
      return;
  }
}

async function loadSettings(): Promise<void> {
  if (window.micToolTs === undefined) {
    state.demoMode = false;
    appShell.dataset.demo = "false";
    demoPill.textContent = "Bridge unavailable";
    resetProductionData();
    renderSettings();
    setSessionState("error");
    addEvent("Bridge unavailable", "preload API did not load");
    return;
  }

  state.demoMode = false;
  appShell.dataset.demo = "false";
  demoPill.textContent = "";
  resetProductionData();
  try {
    const loaded = await window.micToolTs.loadSettings();
    const result = parseSettingsLoadResult(loaded);
    mergeSettings(result.settings);
    renderSettings();
    if (result.ok) {
      setSessionState("idle");
      addEvent("Settings loaded", "resolved config");
    } else {
      setSessionState("error");
      addEvent("Config error", result.error?.message ?? "settings could not be fully resolved");
    }
  } catch (error) {
    setSessionState("error");
    addEvent("Settings error", errorMessage(error));
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function resetProductionData(): void {
  state.transcript = [];
  state.events = [];
  state.partialId = 0;
  state.nextId = 1;
  renderTranscript();
  renderEvents();
}

async function toggleSession(): Promise<void> {
  if (state.current === "running") {
    state.hotkeySessionActive = false;
    await stopSession();
  } else if (state.current === "idle" || state.current === "error") {
    await startSession();
  }
}

async function startSession(): Promise<void> {
  if (window.micToolTs === undefined) {
    setSessionState("error");
    addEvent("Start failed", "preload bridge unavailable");
    return;
  }
  state.transcript = [];
  renderTranscript();
  setSessionState("loading");
  try {
    await window.micToolTs.startSession();
  } catch (error) {
    setSessionState("error");
    addEvent("Start failed", errorMessage(error));
  }
}

async function stopSession(options: { submitPending?: boolean } = {}): Promise<void> {
  if (window.micToolTs === undefined) {
    setSessionState("error");
    addEvent("Stop failed", "preload bridge unavailable");
    return;
  }
  setSessionState("stopping");
  try {
    await window.micToolTs.stopSession(options);
  } catch (error) {
    setSessionState("error");
    addEvent("Stop failed", errorMessage(error));
  }
}

async function startHotkeySession(): Promise<void> {
  if (!state.settings.hotkeyEnabled || state.hotkeySessionActive) return;
  if (state.current !== "idle" && state.current !== "error") return;
  state.hotkeySessionActive = true;
  addEvent("Push-to-talk", "pressed");
  await startSession();
  if (state.current === "error") {
    state.hotkeySessionActive = false;
  }
}

async function stopHotkeySession(): Promise<void> {
  if (!state.hotkeySessionActive) return;
  state.hotkeySessionActive = false;
  addEvent("Push-to-talk", "released");
  await stopSession({ submitPending: true });
}

function currentParsedHotkey(): ParsedHotkey | null {
  if (!state.settings.hotkeyEnabled) return null;
  try {
    return parseHotkeyAccelerator(state.settings.hotkey);
  } catch (error) {
    addEvent("Hotkey error", errorMessage(error));
    return null;
  }
}

function runDemoSession(): void {
  window.clearInterval(state.demoTimer);
  let index = 0;
  state.demoTimer = window.setInterval(() => {
    updatePartial(demoPartials[index % demoPartials.length], "streaming");
    index += 1;
    if (index % demoPartials.length === 0) {
      commitTranscript("final", "Show me the current command status before sending.", "en");
      updatePartial("waiting for the next command...", "streaming");
    }
  }, 1400);
}

function bindControls(): void {
  sessionToggle.addEventListener("click", () => {
    void toggleSession();
  });

  document.querySelectorAll<HTMLElement>("[data-view-button]").forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.viewButton;
      if (isViewName(view)) setActiveView(view);
    });
  });

  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
    "[data-setting-control]",
  ).forEach((control) => {
    control.addEventListener("change", () => {
      mergeSettingsFromControls();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-setting-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.settingToggle;
      if (key === undefined) return;
      toggleBooleanSetting(key);
    });
  });

  window.addEventListener("keydown", (event) => {
    const hotkey = currentParsedHotkey();
    if (hotkey === null || event.repeat || !eventMatchesHotkey(event, hotkey)) return;
    event.preventDefault();
    if (state.hotkeyPressed) return;
    state.hotkeyPressed = true;
    void startHotkeySession();
  });

  window.addEventListener("keyup", (event) => {
    const hotkey = currentParsedHotkey();
    if (hotkey === null || !state.hotkeyPressed || !eventReleasesHotkey(event, hotkey)) return;
    event.preventDefault();
    state.hotkeyPressed = false;
    void stopHotkeySession();
  });

  window.addEventListener("blur", () => {
    if (!state.hotkeyPressed) return;
    state.hotkeyPressed = false;
    void stopHotkeySession();
  });

  const unsubscribe = window.micToolTs?.onSessionEvent((rawEvent: unknown) => {
    const event = parseEvent(rawEvent);
    if (event !== null) handleEvent(event);
  });

  window.addEventListener("beforeunload", () => {
    if (typeof unsubscribe === "function") unsubscribe();
  });
}

function toggleBooleanSetting(key: string): void {
  if (
    key !== "endpointDetection" &&
    key !== "refine" &&
    key !== "translate" &&
    key !== "clipboard" &&
    key !== "focusedInput"
  ) {
    return;
  }
  const settingKey = key as
    | "endpointDetection"
    | "refine"
    | "translate"
    | "clipboard"
    | "focusedInput";
  const next = {
    [settingKey]: !state.settings[settingKey],
  } as Partial<RendererSettings>;
  mergeSettings(next);
  renderSettings();
  void persistSettings(next);
}

function isViewName(value: string | undefined): value is ViewName {
  return (
    value === "monitor" ||
    value === "settings" ||
    value === "protocol" ||
    value === "logs"
  );
}

function renderAll(): void {
  appShell.dataset.demo = state.demoMode ? "true" : "false";
  renderSettings();
  renderTranscript();
  renderEvents();
  setActiveView(state.view);
}

bindControls();
renderAll();
void loadSettings();
