const { app, BrowserWindow, ipcMain, nativeTheme } = require("electron");
const { dirname, join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

async function main() {
  const projectRoot = resolve(dirname(__filename), "..");
  const distUi = join(projectRoot, "dist", "ui");
  const runtimeSettingsModule = await import(
    pathToFileURL(join(distUi, "runtimeSettings.js")).href
  );

  ipcMain.handle("mic-tool-ts:settings:load", () =>
    runtimeSettingsModule.loadRendererSettingsForUi(),
  );
  ipcMain.handle("mic-tool-ts:settings:update", (_event, patch) => patch);
  ipcMain.handle("mic-tool-ts:session:start", () => undefined);
  ipcMain.handle("mic-tool-ts:session:stop", () => undefined);

  await app.whenReady();

  const win = new BrowserWindow({
    width: 1120,
    height: 420,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#191b1f" : "#f4f5f7",
    webPreferences: {
      preload: join(distUi, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.webContents.on("console-message", (_event, _level, message) => {
    process.stderr.write(`[renderer] ${message}\n`);
  });

  await win.loadFile(join(distUi, "renderer", "index.html"));
  await new Promise((resolveReady) => setTimeout(resolveReady, 500));

  const result = await Promise.race([
    win.webContents.executeJavaScript(`
      (async () => {
        const hasBridge = typeof window.micToolTs !== "undefined";
        const loaded = hasBridge ? await window.micToolTs.loadSettings() : null;
        const shell = document.querySelector(".app-shell");
        const settingsButton = document.querySelector('[data-view-button="settings"]');
        settingsButton?.click();
        const settingsView = document.querySelector("#settingsView");
        const inspector = document.querySelector(".inspector");
        const extraSettingsRows = Array.from({ length: 30 }, (_, index) => {
          const row = document.createElement("div");
          row.className = "list-row";
          row.innerHTML = "<span>Overflow row " + index + "</span><strong>value</strong>";
          return row;
        });
        document.querySelector("#settingsList")?.append(...extraSettingsRows);
        const extraInspectorRows = Array.from({ length: 30 }, (_, index) => {
          const row = document.createElement("div");
          row.className = "event-row";
          row.innerHTML = "<span>Inspector overflow " + index + "</span><strong>now</strong>";
          return row;
        });
        document.querySelector("#recentEvents")?.append(...extraInspectorRows);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const settingsStyle = settingsView === null ? null : getComputedStyle(settingsView);
        const inspectorStyle = inspector === null ? null : getComputedStyle(inspector);
        return {
          hasBridge,
          loadOk: loaded?.ok ?? false,
          provider: loaded?.settings?.provider ?? null,
          apiKeyName: loaded?.settings?.apiKeyName ?? null,
          apiKeyStatus: loaded?.settings?.apiKeyStatus ?? null,
          storageStatus: loaded?.settings?.storageStatus ?? null,
          sessionSummary: document.querySelector("#sessionSummary")?.textContent ?? null,
          liveText: document.querySelector("#liveText")?.textContent ?? null,
          bodyScrolls: document.scrollingElement?.scrollHeight > document.scrollingElement?.clientHeight,
          shellOverflow: shell === null ? null : getComputedStyle(shell).overflow,
          settingsOverflowY: settingsStyle?.overflowY ?? null,
          settingsCanScroll: settingsView === null ? false : settingsView.scrollHeight > settingsView.clientHeight,
          inspectorOverflowY: inspectorStyle?.overflowY ?? null,
          inspectorCanScroll: inspector === null ? false : inspector.scrollHeight > inspector.clientHeight
        };
      })()
    `),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error("UI bridge verification timed out")),
      5000,
    )),
  ]);

  if (
    result.bodyScrolls ||
    result.settingsOverflowY !== "auto" ||
    !result.settingsCanScroll ||
    result.inspectorOverflowY !== "auto" ||
    !result.inspectorCanScroll
  ) {
    throw new Error(`UI scrolling verification failed: ${JSON.stringify(result, null, 2)}`);
  }

  console.log(JSON.stringify(result, null, 2));
  win.destroy();
  app.quit();
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  app.exit(1);
});
