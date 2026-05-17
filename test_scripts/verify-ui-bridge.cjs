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
    width: 900,
    height: 680,
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
        return {
          hasBridge,
          loadOk: loaded?.ok ?? false,
          provider: loaded?.settings?.provider ?? null,
          apiKeyName: loaded?.settings?.apiKeyName ?? null,
          apiKeyStatus: loaded?.settings?.apiKeyStatus ?? null,
          storageStatus: loaded?.settings?.storageStatus ?? null,
          sessionSummary: document.querySelector("#sessionSummary")?.textContent ?? null,
          liveText: document.querySelector("#liveText")?.textContent ?? null
        };
      })()
    `),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error("UI bridge verification timed out")),
      5000,
    )),
  ]);

  console.log(JSON.stringify(result, null, 2));
  win.destroy();
  app.quit();
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  app.exit(1);
});
