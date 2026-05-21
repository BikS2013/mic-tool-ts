import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeTheme, shell } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  runMicSession,
  type AudioGate,
  type SubmitPendingControl,
  type SubmitPendingListener,
} from "../core/sessionRunner.js";
import type { SessionEvent } from "../core/sessionEvents.js";
import { GlobalHotkeyManager } from "./globalHotkeyManager.js";
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

const __dirname = dirname(fileURLToPath(import.meta.url));

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
    await configureGlobalHotkey();
    void reconcileHotkeyWarmSession();
  }).catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    app.exit(1);
  });
}

app.on("window-all-closed", () => {
  void stopSession();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  globalHotkeyManager?.stop();
  void stopSession();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

function registerIpc(): void {
  ipcMain.handle("mic-tool-ts:settings:load", () => loadSettingsForRenderer());
  ipcMain.handle("mic-tool-ts:settings:update", (_event, patch: unknown) => {
    if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
      throw new Error("Settings update payload must be an object.");
    }
    latestSettings = refreshCredentialStatus(mergeRendererSettings(
      latestSettings,
      patch as Partial<RendererSettings>,
    ));
    saveUiSettings(latestSettings);
    void configureGlobalHotkey();
    void reconcileHotkeyWarmSession({ restartExistingHotkeySession: true });
    emitSessionEvent({
      type: "config.saved",
      message: "settings updated",
    });
    return latestSettings;
  });
  ipcMain.handle("mic-tool-ts:session:start", async (_event, options: unknown) => {
    const startOptions = normalizeStartOptions(options);
    if (startOptions.hotkey === true) {
      await startHotkeySession();
      return;
    }
    await startSession({ owner: "manual" });
  });
  ipcMain.handle("mic-tool-ts:session:stop", async (_event, options: unknown) => {
    await stopSession(normalizeStopOptions(options));
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
    hotkeyPressed = false;
    void stopHotkeySession();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadFile(rendererPath);
}

function createGlobalHotkeyManager(): void {
  globalHotkeyManager = new GlobalHotkeyManager({
    onPress: () => startHotkeySession(),
    onRelease: () => stopHotkeySession(),
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
  }).then((code) => {
    sessionRunning = false;
    sessionAbort = null;
    sessionOwner = null;
    hotkeyPressed = false;
    hotkeySessionActive = false;
    hotkeySessionControl = null;
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
  await stopSession();
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
    void startHotkeySession();
    return true;
  }

  if (!hotkeyPressed || !eventReleasesHotkey(input, hotkey, process.platform === "darwin")) {
    return false;
  }
  hotkeyPressed = false;
  void stopHotkeySession();
  return true;
}

async function startHotkeySession(): Promise<void> {
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
  emitSessionEvent({
    type: "diagnostic.info",
    message: "[mic-tool-ts] push-to-talk pressed",
  });
}

async function stopHotkeySession(): Promise<void> {
  hotkeyPressed = false;
  if (!hotkeySessionActive || sessionOwner !== "hotkey" || hotkeySessionControl === null) return;
  hotkeySessionControl.close();
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
    latestSettings = settingsFromConfig(event.config, latestSettings);
    void configureGlobalHotkey();
  }
  mainWindow?.webContents.send("mic-tool-ts:session:event", event);
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
