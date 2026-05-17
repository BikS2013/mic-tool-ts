import { app, BrowserWindow, ipcMain, Menu, nativeTheme, shell } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runMicSession } from "../core/sessionRunner.js";
import type { SessionEvent } from "../core/sessionEvents.js";
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
  type UiSettingsLoadResult,
} from "./shared.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let sessionAbort: AbortController | null = null;
let sessionRunning = false;
let latestSettings: RendererSettings = { ...DEFAULT_RENDERER_SETTINGS };

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
    createMenu();
    await createWindow();
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
    emitSessionEvent({
      type: "config.saved",
      message: "settings updated",
    });
    return latestSettings;
  });
  ipcMain.handle("mic-tool-ts:session:start", async () => {
    await startSession();
  });
  ipcMain.handle("mic-tool-ts:session:stop", async () => {
    await stopSession();
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
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadFile(rendererPath);
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
    if (code !== 0) {
      emitSessionEvent({
        type: "diagnostic.warning",
        message: `[mic-tool-ts] UI session exited with code ${code}`,
      });
    }
  }).catch((err: unknown) => {
    sessionRunning = false;
    sessionAbort = null;
    emitSessionEvent({
      type: "session.error",
      code: "UNKNOWN",
      message: err instanceof Error ? err.message : String(err),
      exitCode: 1,
    });
  });
}

async function stopSession(): Promise<void> {
  if (sessionAbort === null) return;
  sessionAbort.abort();
}

function emitSessionEvent(event: SessionEvent): void {
  if (event.type === "config.loaded") {
    latestSettings = settingsFromConfig(event.config);
  }
  mainWindow?.webContents.send("mic-tool-ts:session:event", event);
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
