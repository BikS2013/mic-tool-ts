import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeTheme, shell } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runMicSession } from "../core/sessionRunner.js";
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
import {
  DEFAULT_RENDERER_SETTINGS,
  mergeRendererSettings,
  settingsFromConfig,
  settingsToSessionArgs,
  type RendererSettings,
  type StopSessionOptions,
  type UiSettingsLoadResult,
} from "./shared.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let sessionAbort: AbortController | null = null;
let sessionRunning = false;
let latestSettings: RendererSettings = { ...DEFAULT_RENDERER_SETTINGS };
let hotkeyPressed = false;
let hotkeySessionActive = false;
let globalHotkeyManager: GlobalHotkeyManager | null = null;

interface UiStopReason {
  readonly source: "manual" | "hotkey";
  readonly submitPending: boolean;
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
    void configureGlobalHotkey();
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
    void configureGlobalHotkey();
    emitSessionEvent({
      type: "config.saved",
      message: "settings updated",
    });
    return latestSettings;
  });
  ipcMain.handle("mic-tool-ts:session:start", async () => {
    await startSession();
  });
  ipcMain.handle("mic-tool-ts:session:stop", async (_event, options: unknown) => {
    await stopSession(normalizeStopOptions(options));
  });
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

async function startSession(): Promise<void> {
  if (sessionRunning) return;
  sessionRunning = true;
  sessionAbort = new AbortController();
  const argv = ["node", "mic-tool-ts", ...settingsToSessionArgs(latestSettings)];

  void runMicSession(argv, {
    frontend: "ui",
    handleProcessSignals: false,
    abortSignal: sessionAbort.signal,
    onEvent: emitSessionEvent,
  }).then((code) => {
    sessionRunning = false;
    sessionAbort = null;
    hotkeyPressed = false;
    hotkeySessionActive = false;
    if (code !== 0) {
      emitSessionEvent({
        type: "diagnostic.warning",
        message: `[mic-tool-ts] UI session exited with code ${code}`,
      });
    }
  }).catch((err: unknown) => {
    sessionRunning = false;
    sessionAbort = null;
    hotkeyPressed = false;
    hotkeySessionActive = false;
    emitSessionEvent({
      type: "session.error",
      code: "UNKNOWN",
      message: err instanceof Error ? err.message : String(err),
      exitCode: 1,
    });
  });
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
  if (sessionRunning) return;
  hotkeySessionActive = true;
  emitSessionEvent({
    type: "diagnostic.info",
    message: "[mic-tool-ts] push-to-talk pressed",
  });
  await startSession();
}

async function stopHotkeySession(): Promise<void> {
  hotkeyPressed = false;
  if (!hotkeySessionActive) return;
  hotkeySessionActive = false;
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
  if (sessionAbort === null) return;
  const reason: UiStopReason = {
    source: options.submitPending === true ? "hotkey" : "manual",
    submitPending: options.submitPending === true,
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
            void startSession();
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
