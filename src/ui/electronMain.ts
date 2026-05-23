import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeTheme, shell } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvChain } from "../config/envChain.js";
import { parseBoolean } from "../config/parsers.js";
import {
  runMicSession,
  type AudioGate,
  type ProtocolFeatureToggleControl,
  type ProtocolFeatureToggleListener,
  type SubmitPendingControl,
  type SubmitPendingListener,
} from "../core/sessionRunner.js";
import type { SessionEvent } from "../core/sessionEvents.js";
import type { OperatorKey, OperatorState } from "../protocol/types.js";
import { GlobalHotkeyManager, type GlobalHotkeyEventSource } from "./globalHotkeyManager.js";
import {
  eventMatchesHotkey,
  eventReleasesHotkey,
  parseHotkeyAccelerator,
  type HotkeyKeyboardEventLike,
} from "./hotkey.js";
import {
  loadRendererSettingsForUi,
  refreshCredentialStatus,
} from "./runtimeSettings.js";
import { savePersistedUiSettings } from "./settingsStore.js";
import {
  DEFAULT_RENDERER_SETTINGS,
  mergeRendererSettings,
  settingsFromConfig,
  settingsToSessionArgs,
  type RendererSettings,
  type StartSessionOptions,
  type StopSessionOptions,
  type UiSettingsLoadResult,
} from "./shared.js";
import { TranscriptionOverlayManager } from "./transcriptionOverlay.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WARM_SESSION_RECYCLE_MS = 5 * 60 * 1000;
type UiHotkeyEventSource =
  | GlobalHotkeyEventSource
  | "focused-window"
  | "renderer-ipc"
  | "app-blur";

let mainWindow: BrowserWindow | null = null;
let sessionAbort: AbortController | null = null;
let sessionRunning = false;
let sessionOwner: "manual" | "hotkey" | null = null;
let latestSettings: RendererSettings = { ...DEFAULT_RENDERER_SETTINGS };
let hotkeyPressed = false;
let hotkeySessionActive = false;
let hotkeySessionControl: HotkeySessionControl | null = null;
let restartWarmSessionAfterStop = false;
let globalHotkeyManager: GlobalHotkeyManager | null = null;
let warmSessionRecycleTimer: NodeJS.Timeout | undefined;
let warmSessionRecycleInFlight = false;
let transcriptionOverlay: TranscriptionOverlayManager | null = null;
let latestProtocolFeatures: OperatorState = protocolFeaturesFromSettings(latestSettings);
let uiVerboseDiagnostics = readUiVerboseDiagnostics();

interface UiStopReason {
  readonly source: "manual" | "hotkey";
  readonly submitPending: boolean;
}

class HotkeySessionControl implements AudioGate, SubmitPendingControl {
  private gateOpen = false;
  private readonly listeners = new Set<SubmitPendingListener>();

  isOpen(): boolean {
    return this.gateOpen;
  }

  open(): void {
    this.gateOpen = true;
  }

  close(): void {
    this.gateOpen = false;
  }

  subscribe(listener: SubmitPendingListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async submitPending(): Promise<void> {
    await Promise.all(Array.from(this.listeners, (listener) => listener()));
  }
}

class RuntimeProtocolFeatureControl implements ProtocolFeatureToggleControl {
  private readonly protocolFeatureListeners = new Set<ProtocolFeatureToggleListener>();
  private readonly pendingProtocolFeatureToggles: OperatorKey[] = [];

  subscribeProtocolFeatureToggle(listener: ProtocolFeatureToggleListener): () => void {
    this.protocolFeatureListeners.add(listener);
    while (this.pendingProtocolFeatureToggles.length > 0) {
      listener(this.pendingProtocolFeatureToggles.shift() as OperatorKey);
    }
    return () => {
      this.protocolFeatureListeners.delete(listener);
    };
  }

  toggleProtocolFeature(key: OperatorKey): void {
    if (this.protocolFeatureListeners.size === 0) {
      this.pendingProtocolFeatureToggles.push(key);
      return;
    }
    for (const listener of this.protocolFeatureListeners) {
      listener(key);
    }
  }

  clearPending(): void {
    this.pendingProtocolFeatureToggles.length = 0;
  }
}

const runtimeProtocolFeatureControl = new RuntimeProtocolFeatureControl();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow === null) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    registerIpc();
    createGlobalHotkeyManager();
    createMenu();
    await createWindow();
    createTranscriptionOverlay();
    await configureGlobalHotkey();
    void reconcileHotkeyWarmSession();
  }).catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    app.exit(1);
  });
}

app.on("window-all-closed", () => {
  clearWarmSessionRecycleTimer();
  transcriptionOverlay?.destroy();
  transcriptionOverlay = null;
  void stopSession();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  clearWarmSessionRecycleTimer();
  transcriptionOverlay?.destroy();
  transcriptionOverlay = null;
  globalHotkeyManager?.stop();
  void stopSession();
});

app.on("activate", () => {
  if (mainWindow === null) {
    void createWindow().then(() => {
      createTranscriptionOverlay();
    });
  }
});

function registerIpc(): void {
  ipcMain.handle("mic-tool-ts:settings:load", () => loadSettingsForRenderer());
  ipcMain.handle("mic-tool-ts:settings:update", (_event, patch: unknown) => {
    if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
      throw new Error("Settings update payload must be an object.");
    }
    const settingsPatch = patch as Partial<RendererSettings>;
    const previousProtocolFeatures = latestProtocolFeatures;
    latestSettings = refreshCredentialStatus(mergeRendererSettings(
      latestSettings,
      settingsPatch,
    ));
    latestProtocolFeatures = protocolFeaturesFromSettings(latestSettings);
    saveUiSettings(latestSettings);
    applyRuntimeProtocolFeatureChanges(previousProtocolFeatures, latestProtocolFeatures);
    if (!isProtocolSwitchOnlyPatch(settingsPatch)) {
      void configureGlobalHotkey();
      void reconcileHotkeyWarmSession({ restartExistingHotkeySession: true });
    }
    emitSessionEvent({
      type: "config.saved",
      message: "settings updated",
    });
    return latestSettings;
  });
  ipcMain.handle("mic-tool-ts:session:start", async (_event, options: unknown) => {
    const startOptions = normalizeStartOptions(options);
    if (startOptions.hotkey === true) {
      await startHotkeySession("renderer-ipc");
      return;
    }
    await startSession({ owner: "manual" });
  });
  ipcMain.handle("mic-tool-ts:session:stop", async (_event, options: unknown) => {
    await stopSession(normalizeStopOptions(options));
  });
  ipcMain.handle("mic-tool-ts:protocol:toggle", (_event, key: unknown) => {
    toggleProtocolFeature(normalizeOperatorKey(key));
  });
}

function saveUiSettings(settings: RendererSettings): void {
  savePersistedUiSettings(settings, { toolName: "mic-tool-ts" });
}

async function createWindow(): Promise<void> {
  loadSettingsForRenderer();

  const preload = join(__dirname, "preload.cjs");
  const rendererPath = join(__dirname, "renderer", "index.html");

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 860,
    minHeight: 620,
    show: false,
    title: "mic-tool-ts",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: "sidebar",
    visualEffectState: "followWindow",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#191b1f" : "#f4f5f7",
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) {
      event.preventDefault();
    }
  });
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (handlePushToTalkInput(toHotkeyEvent(input), input.type, input.isAutoRepeat)) {
      event.preventDefault();
    }
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.on("blur", () => {
    if (globalHotkeyManager?.isRunning === true) return;
    if (!hotkeyPressed) return;
    void stopHotkeySession("app-blur");
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    transcriptionOverlay?.destroy();
    transcriptionOverlay = null;
  });

  await mainWindow.loadFile(rendererPath);
}

function createTranscriptionOverlay(): void {
  if (transcriptionOverlay !== null) return;
  transcriptionOverlay = new TranscriptionOverlayManager({
    preloadPath: join(__dirname, "preload.cjs"),
    rendererPath: join(__dirname, "renderer", "overlay.html"),
    onDiagnostic: emitVerboseUiDiagnostic,
  });
}

function createGlobalHotkeyManager(): void {
  globalHotkeyManager = new GlobalHotkeyManager({
    onPress: (source) => startHotkeySession(source),
    onRelease: (source) => stopHotkeySession(source),
    onProtocolToggle: (key) => toggleProtocolFeature(key),
    onWarning: (message) => emitSessionEvent({
      type: "diagnostic.warning",
      message,
    }),
    globalShortcut,
    isMac: process.platform === "darwin",
  });
}

async function configureGlobalHotkey(): Promise<void> {
  await globalHotkeyManager?.configure({
    enabled: latestSettings.hotkeyEnabled,
    hotkey: latestSettings.hotkey,
  });
}

function loadSettingsForRenderer(): UiSettingsLoadResult {
  const result = loadRendererSettingsForUi(latestSettings);
  latestSettings = result.settings;
  latestProtocolFeatures = protocolFeaturesFromSettings(latestSettings);
  if (!result.ok && result.error !== undefined) {
    emitSessionEvent({
      type: "diagnostic.warning",
      message: result.error.message,
    });
  }
  return result;
}

interface StartSessionInternalOptions {
  readonly owner: "manual" | "hotkey";
  readonly hotkeyControl?: HotkeySessionControl;
}

async function startSession(options: StartSessionInternalOptions): Promise<void> {
  if (sessionRunning) return;
  sessionRunning = true;
  sessionOwner = options.owner;
  sessionAbort = new AbortController();
  const argv = ["node", "mic-tool-ts", ...settingsToSessionArgs(latestSettings)];

  void runMicSession(argv, {
    frontend: "ui",
    handleProcessSignals: false,
    abortSignal: sessionAbort.signal,
    onEvent: emitSessionEvent,
    audioGate: options.hotkeyControl,
    submitPendingControl: options.hotkeyControl,
    protocolFeatureToggleControl: runtimeProtocolFeatureControl,
  }).then((code) => {
    sessionRunning = false;
    sessionAbort = null;
    sessionOwner = null;
    hotkeyPressed = false;
    hotkeySessionActive = false;
    hotkeySessionControl = null;
    runtimeProtocolFeatureControl.clearPending();
    emitCaptureState("idle", "session stopped");
    if (code !== 0) {
      emitSessionEvent({
        type: "diagnostic.warning",
        message: `[mic-tool-ts] UI session exited with code ${code}`,
      });
    }
    if (restartWarmSessionAfterStop) {
      restartWarmSessionAfterStop = false;
      void reconcileHotkeyWarmSession();
    }
  }).catch((err: unknown) => {
    sessionRunning = false;
    sessionAbort = null;
    sessionOwner = null;
    hotkeyPressed = false;
    hotkeySessionActive = false;
    hotkeySessionControl = null;
    runtimeProtocolFeatureControl.clearPending();
    emitCaptureState("idle", "session error");
    emitSessionEvent({
      type: "session.error",
      code: "UNKNOWN",
      message: err instanceof Error ? err.message : String(err),
      exitCode: 1,
    });
    if (restartWarmSessionAfterStop) {
      restartWarmSessionAfterStop = false;
      void reconcileHotkeyWarmSession();
    }
  });
}

async function reconcileHotkeyWarmSession(
  options: { restartExistingHotkeySession?: boolean } = {},
): Promise<void> {
  if (!latestSettings.hotkeyEnabled) {
    await stopHotkeyWarmSession();
    return;
  }
  if (sessionRunning) {
    if (sessionOwner === "hotkey" && options.restartExistingHotkeySession === true) {
      restartWarmSessionAfterStop = true;
      await stopHotkeyWarmSession();
    }
    return;
  }
  await startHotkeyWarmSession();
}

async function startHotkeyWarmSession(): Promise<void> {
  if (!latestSettings.hotkeyEnabled || sessionRunning) return;
  hotkeySessionControl = new HotkeySessionControl();
  hotkeySessionControl.close();
  hotkeySessionActive = true;
  emitSessionEvent({
    type: "diagnostic.info",
    message: "[mic-tool-ts] push-to-talk warmed",
  });
  await startSession({
    owner: "hotkey",
    hotkeyControl: hotkeySessionControl,
  });
}

async function stopHotkeyWarmSession(): Promise<void> {
  hotkeyPressed = false;
  hotkeySessionControl?.close();
  if (sessionOwner !== "hotkey") return;
  hotkeySessionActive = false;
  emitCaptureState("idle", "warm session stopped");
  await stopSession();
}

function scheduleWarmSessionRecycle(): void {
  clearWarmSessionRecycleTimer();
  if (
    !latestSettings.hotkeyEnabled ||
    !sessionRunning ||
    sessionOwner !== "hotkey" ||
    hotkeyPressed ||
    hotkeySessionControl === null
  ) {
    return;
  }
  warmSessionRecycleTimer = setTimeout(() => {
    warmSessionRecycleTimer = undefined;
    void recycleWarmSession();
  }, WARM_SESSION_RECYCLE_MS);
  warmSessionRecycleTimer.unref?.();
}

function clearWarmSessionRecycleTimer(): void {
  if (warmSessionRecycleTimer === undefined) return;
  clearTimeout(warmSessionRecycleTimer);
  warmSessionRecycleTimer = undefined;
}

async function recycleWarmSession(): Promise<void> {
  if (warmSessionRecycleInFlight) return;
  if (
    !latestSettings.hotkeyEnabled ||
    !sessionRunning ||
    sessionOwner !== "hotkey" ||
    hotkeyPressed ||
    hotkeySessionControl === null
  ) {
    return;
  }
  warmSessionRecycleInFlight = true;
  restartWarmSessionAfterStop = true;
  emitSessionEvent({
    type: "diagnostic.info",
    message: "[mic-tool-ts] recycling warm push-to-talk session",
  });
  emitCaptureState("idle", "warm session recycling");
  try {
    await stopHotkeyWarmSession();
  } finally {
    warmSessionRecycleInFlight = false;
  }
}

function handlePushToTalkInput(
  input: HotkeyKeyboardEventLike,
  type: string,
  isAutoRepeat: boolean,
): boolean {
  if (!latestSettings.hotkeyEnabled) return false;
  let hotkey;
  try {
    hotkey = parseHotkeyAccelerator(latestSettings.hotkey);
  } catch (error) {
    emitSessionEvent({
      type: "diagnostic.warning",
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }

  if (type === "keyDown") {
    if (isAutoRepeat || !eventMatchesHotkey(input, hotkey, process.platform === "darwin")) {
      return false;
    }
    if (hotkeyPressed) return true;
    void startHotkeySession("focused-window");
    return true;
  }

  if (!hotkeyPressed || !eventReleasesHotkey(input, hotkey, process.platform === "darwin")) {
    return false;
  }
  void stopHotkeySession("focused-window");
  return true;
}

async function startHotkeySession(source: UiHotkeyEventSource): Promise<void> {
  emitVerboseUiDiagnostic(
    `hotkey.press source=${source} hotkeyPressedBefore=${String(hotkeyPressed)} ` +
      `sessionRunning=${String(sessionRunning)} sessionOwner=${sessionOwner ?? "none"} ` +
      `hotkeySessionActive=${String(hotkeySessionActive)} ` +
      `gateOpen=${String(hotkeySessionControl?.isOpen() ?? false)}`,
  );
  if (hotkeyPressed) return;
  hotkeyPressed = true;
  if (sessionRunning && sessionOwner === "hotkey" && hotkeySessionControl !== null) {
    hotkeySessionControl.open();
  } else if (sessionRunning) {
    return;
  } else {
    hotkeySessionControl = new HotkeySessionControl();
    hotkeySessionControl.open();
    hotkeySessionActive = true;
    await startSession({
      owner: "hotkey",
      hotkeyControl: hotkeySessionControl,
    });
  }
  emitCaptureState("recording", "push-to-talk pressed");
  emitSessionEvent({
    type: "diagnostic.info",
    message: "[mic-tool-ts] push-to-talk pressed",
  });
}

async function stopHotkeySession(source: UiHotkeyEventSource): Promise<void> {
  emitVerboseUiDiagnostic(
    `hotkey.release source=${source} hotkeyPressedBefore=${String(hotkeyPressed)} ` +
      `sessionRunning=${String(sessionRunning)} sessionOwner=${sessionOwner ?? "none"} ` +
      `hotkeySessionActive=${String(hotkeySessionActive)} ` +
      `gateOpen=${String(hotkeySessionControl?.isOpen() ?? false)}`,
  );
  hotkeyPressed = false;
  if (!hotkeySessionActive || sessionOwner !== "hotkey" || hotkeySessionControl === null) return;
  hotkeySessionControl.close();
  emitCaptureState("warm", "push-to-talk released");
  emitSessionEvent({
    type: "diagnostic.info",
    message: "[mic-tool-ts] push-to-talk released",
  });
  await stopSession({ submitPending: true });
}

function toHotkeyEvent(input: Electron.Input): HotkeyKeyboardEventLike {
  return {
    key: input.key,
    code: input.code,
    ctrlKey: input.control,
    metaKey: input.meta,
    altKey: input.alt,
    shiftKey: input.shift,
    repeat: input.isAutoRepeat,
  };
}

async function stopSession(options: StopSessionOptions = {}): Promise<void> {
  if (options.submitPending === true) {
    if (sessionOwner === "hotkey" && hotkeySessionControl !== null) {
      await hotkeySessionControl.submitPending();
    }
    return;
  }
  if (sessionAbort === null) return;
  const reason: UiStopReason = {
    source: "manual",
    submitPending: false,
  };
  sessionAbort.abort(reason);
}

function emitSessionEvent(event: SessionEvent): void {
  if (event.type === "config.loaded") {
    uiVerboseDiagnostics = event.config.verbose;
    latestSettings = settingsFromConfig(event.config, latestSettings);
    latestProtocolFeatures = { ...event.config.operators };
    void configureGlobalHotkey();
  }
  if (event.type === "protocol.event" && event.event.type === "state.changed") {
    latestSettings = mergeRendererSettings(
      latestSettings,
      protocolFeatureSettingsPatch(event.event.key, event.event.value),
    );
    latestProtocolFeatures = {
      ...latestProtocolFeatures,
      [event.event.key]: event.event.value,
    };
  }
  deliverSessionEvent(event);
  if (
    event.type === "session.state" &&
    event.state === "listening" &&
    sessionOwner === "hotkey"
  ) {
    emitCaptureState(hotkeyPressed ? "recording" : "warm", "hotkey session listening");
  }
}

function emitCaptureState(state: "idle" | "warm" | "recording", reason: string): void {
  emitVerboseUiDiagnostic(
    `capture.state state=${state} reason=${quoteDiagnosticValue(reason)} ` +
      `sessionOwner=${sessionOwner ?? "none"} hotkeyPressed=${String(hotkeyPressed)} ` +
      `hotkeySessionActive=${String(hotkeySessionActive)} ` +
      `gateOpen=${String(hotkeySessionControl?.isOpen() ?? false)} ` +
      `warmRecycleTimerActive=${String(warmSessionRecycleTimer !== undefined)}`,
  );
  if (state === "warm") {
    scheduleWarmSessionRecycle();
  } else {
    clearWarmSessionRecycleTimer();
  }
  deliverSessionEvent({
    type: "capture.state",
    state,
    reason,
  } satisfies SessionEvent);
}

function deliverSessionEvent(event: SessionEvent): void {
  mainWindow?.webContents.send("mic-tool-ts:session:event", event);
  transcriptionOverlay?.handleSessionEvent(event, {
    hotkeyOwned: sessionOwner === "hotkey",
    hotkey: latestSettings.hotkey,
    protocolFeatures: latestProtocolFeatures,
  });
}

function emitVerboseUiDiagnostic(detail: string): void {
  if (!uiVerboseDiagnostics) return;
  const message = `[mic-tool-ts] ui diagnostic: ${detail}`;
  process.stderr.write(`${message}\n`);
  mainWindow?.webContents.send("mic-tool-ts:session:event", {
    type: "diagnostic.info",
    message,
  } satisfies SessionEvent);
}

function readUiVerboseDiagnostics(): boolean {
  try {
    const value = loadEnvChain({ toolName: "mic-tool-ts" }).value("MIC_TOOL_TS_VERBOSE");
    return value === undefined
      ? false
      : parseBoolean(value, "--verbose", "MIC_TOOL_TS_VERBOSE");
  } catch {
    return false;
  }
}

function quoteDiagnosticValue(value: string): string {
  return JSON.stringify(value);
}

function toggleProtocolFeature(key: OperatorKey): void {
  if (!sessionRunning) return;
  runtimeProtocolFeatureControl.toggleProtocolFeature(key);
}

function applyRuntimeProtocolFeatureChanges(
  previous: OperatorState,
  next: OperatorState,
): void {
  for (const key of OPERATOR_KEYS) {
    if (previous[key] === next[key]) continue;
    if (!sessionRunning) continue;
    runtimeProtocolFeatureControl.toggleProtocolFeature(key);
  }
}

const OPERATOR_KEYS: readonly OperatorKey[] = ["refine", "translate", "clipboard", "input"];

function isProtocolSwitchOnlyPatch(patch: Partial<RendererSettings>): boolean {
  const keys = Object.keys(patch);
  return keys.length > 0 && keys.every((key) =>
    key === "refine" ||
    key === "translate" ||
    key === "clipboard" ||
    key === "focusedInput" ||
    key === "inputStatus"
  );
}

function protocolFeatureSettingsPatch(
  key: OperatorKey,
  value: boolean,
): Partial<RendererSettings> {
  if (key === "input") {
    return {
      focusedInput: value,
      inputStatus: value ? "Ready" : "Off",
    };
  }
  return { [key]: value } as Partial<RendererSettings>;
}

function normalizeOperatorKey(value: unknown): OperatorKey {
  if (
    value === "refine" ||
    value === "translate" ||
    value === "clipboard" ||
    value === "input"
  ) {
    return value;
  }
  throw new Error(`Unsupported protocol feature: ${String(value)}`);
}

function protocolFeaturesFromSettings(settings: RendererSettings): OperatorState {
  return {
    refine: settings.refine,
    translate: settings.translate,
    clipboard: settings.clipboard,
    input: settings.focusedInput,
  };
}

function normalizeStopOptions(value: unknown): StopSessionOptions {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return {
    submitPending: (value as StopSessionOptions).submitPending === true,
  };
}

function normalizeStartOptions(value: unknown): StartSessionOptions {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return {
    hotkey: (value as StartSessionOptions).hotkey === true,
  };
}

function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Session",
      submenu: [
        {
          label: "Start Listening",
          accelerator: "CommandOrControl+R",
          click: () => {
            void startSession({ owner: "manual" });
          },
        },
        {
          label: "Stop Listening",
          accelerator: "CommandOrControl+.",
          click: () => {
            void stopSession();
          },
        },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
