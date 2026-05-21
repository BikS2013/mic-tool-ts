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
  ipcMain.handle("mic-tool-ts:protocol:toggle", () => undefined);

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

  const sessionEvents = [
    { type: "transcript.final", text: "Open the settings file", source: "el" },
    { type: "transcript.final", text: "and verify the API key.", source: "el" },
    { type: "transcript.turnBoundary" },
    { type: "transcript.refined", text: "Open the configuration file and verify the API key.", target: "refined" },
    { type: "transcript.refined", text: "Ανοίξτε το αρχείο ρυθμίσεων και ελέγξτε το κλειδί API.", target: "translated" },
    { type: "transcript.partial", text: "starting the next turn...", language: "streaming" },
    { type: "capture.state", state: "recording", reason: "push-to-talk pressed" },
  ];
  for (const event of sessionEvents) {
    win.webContents.send("mic-tool-ts:session:event", event);
  }
  await new Promise((resolveReady) => setTimeout(resolveReady, 100));

  const recordingResult = await win.webContents.executeJavaScript(`({
    statusText: document.querySelector("#sessionStatusText")?.textContent ?? null,
    toggleText: document.querySelector("#sessionToggle")?.textContent ?? null,
    shellState: document.querySelector(".app-shell")?.getAttribute("data-state") ?? null
  })`);
  win.webContents.send("mic-tool-ts:session:event", {
    type: "capture.state",
    state: "warm",
    reason: "push-to-talk released",
  });
  await new Promise((resolveReady) => setTimeout(resolveReady, 100));

  const result = await Promise.race([
    win.webContents.executeJavaScript(`
      (async () => {
        const hasBridge = typeof window.micToolTs !== "undefined";
        const loaded = hasBridge ? await window.micToolTs.loadSettings() : null;
        const shell = document.querySelector(".app-shell");
        const settingsButton = document.querySelector('[data-view-button="settings"]');
        const timeline = document.querySelector("#timeline");
        const monitorView = document.querySelector("#monitorView");
        const clearTranscriptButton = document.querySelector("#clearTranscript");
        const llmProviderControl = document.querySelector("#llmProviderControl");
        const llmModelControl = document.querySelector("#llmModelControl");
        const providerControl = document.querySelector("#providerControl");
        const translationPolicyControl = document.querySelector("#translationPolicyControl");
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const groupedTurnRowsBeforeClear = document.querySelectorAll(".transcript-turn").length;
        const groupedBubbleTextsBeforeClear = Array.from(
          document.querySelectorAll(".transcript-turn:first-of-type .bubble .text"),
          (node) => node.textContent ?? "",
        );
        const groupedStatusesBeforeClear = Array.from(
          document.querySelectorAll(".transcript-turn:first-of-type .bubble .meta span:last-child"),
          (node) => node.textContent ?? "",
        );
        const transcriptCountBeforeClear = document.querySelector("#transcriptCount")?.textContent ?? null;
        const liveTextBeforeClear = document.querySelector("#liveText")?.textContent ?? null;
        const warmStatusText = document.querySelector("#sessionStatusText")?.textContent ?? null;
        const warmToggleText = document.querySelector("#sessionToggle")?.textContent ?? null;
        const warmShellState = shell?.getAttribute("data-state") ?? null;
        clearTranscriptButton?.click();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const clearEmptiedTimeline = timeline?.childElementCount === 0;
        const clearResetLiveText = document.querySelector("#liveText")?.textContent === "Waiting for audio...";
        const clearResetTranscriptCount = document.querySelector("#transcriptCount")?.textContent === "0";
        const longTranscriptText = "This is a long transcript line that should wrap inside the monitor pane instead of forcing the center content area to overflow horizontally. ".repeat(6) + "supercalifragilisticexpialidocious-supercalifragilisticexpialidocious";
        const transcriptRows = Array.from({ length: 20 }, (_, index) => {
          const row = document.createElement("article");
          row.className = "transcript-row";
          const time = document.createElement("div");
          time.className = "time";
          time.textContent = "00:" + String(index).padStart(2, "0");
          const bubble = document.createElement("div");
          bubble.className = index % 3 === 0 ? "bubble processed" : "bubble";
          const meta = document.createElement("div");
          meta.className = "meta";
          meta.innerHTML = "<span>Processed section</span><span>ready</span>";
          const text = document.createElement("div");
          text.className = "text";
          text.textContent = longTranscriptText;
          bubble.append(meta, text);
          row.append(time, bubble);
          return row;
        });
        timeline?.replaceChildren(...transcriptRows);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const monitorRect = monitorView?.getBoundingClientRect() ?? null;
        const transcriptRects = Array.from(document.querySelectorAll(".transcript-row, .bubble"), (node) =>
          node.getBoundingClientRect(),
        );
        const transcriptStaysInsideMonitor = monitorRect === null
          ? false
          : transcriptRects.every((rect) =>
            rect.left >= monitorRect.left - 1 &&
            rect.right <= monitorRect.right + 1
          );
        const timelineCanScroll = timeline === null
          ? false
          : timeline.scrollHeight > timeline.clientHeight;
        const timelineNoHorizontalOverflow = timeline === null
          ? false
          : timeline.scrollWidth <= timeline.clientWidth + 1;
        settingsButton?.click();
        const settingsView = document.querySelector("#settingsView");
        const inspector = document.querySelector(".inspector");
        const extraSettingsRows = Array.from({ length: 30 }, (_, index) => {
          const row = document.createElement("label");
          row.className = "field-row";
          const label = document.createElement("span");
          label.textContent = "Overflow setting " + index;
          const input = document.createElement("input");
          input.value = "value";
          row.append(label, input);
          return row;
        });
        document.querySelector("#settingsForm")?.append(...extraSettingsRows);
        const recentEvents = document.querySelector("#recentEvents");
        const extraInspectorRows = Array.from({ length: 30 }, (_, index) => {
          const row = document.createElement("div");
          row.className = "event-row";
          row.innerHTML = "<span>Inspector reset event with a long status label " + index + "</span><strong>12:59:59 PM</strong>";
          return row;
        });
        recentEvents?.append(...extraInspectorRows);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const settingsStyle = settingsView === null ? null : getComputedStyle(settingsView);
        const inspectorStyle = inspector === null ? null : getComputedStyle(inspector);
        const recentEventsStyle = recentEvents === null ? null : getComputedStyle(recentEvents);
        const captureBarStyle = getComputedStyle(document.querySelector(".capture-bar"));
        const recentEventRects = Array.from(document.querySelectorAll("#recentEvents .event-row, #recentEvents .event-row span, #recentEvents .event-row strong"), (node) =>
          node.getBoundingClientRect(),
        );
        const inspectorRect = inspector?.getBoundingClientRect() ?? null;
        const inspectorEventsStayInside = inspectorRect === null
          ? false
          : recentEventRects.every((rect) =>
            rect.left >= inspectorRect.left - 1 &&
            rect.right <= inspectorRect.right + 1
          );
        return {
          hasBridge,
          loadOk: loaded?.ok ?? false,
          provider: loaded?.settings?.provider ?? null,
          llmProvider: loaded?.settings?.llmProvider ?? null,
          llmModel: loaded?.settings?.llmModel ?? null,
          llmProviderControlExists: llmProviderControl instanceof HTMLSelectElement,
          llmModelControlExists: llmModelControl instanceof HTMLInputElement,
          clearTranscriptButtonExists: clearTranscriptButton instanceof HTMLButtonElement,
          groupedTurnRowsBeforeClear,
          groupedBubbleTextsBeforeClear,
          groupedStatusesBeforeClear,
          transcriptCountBeforeClear,
          liveTextBeforeClear,
          warmStatusText,
          warmToggleText,
          warmShellState,
          clearEmptiedTimeline,
          clearResetLiveText,
          clearResetTranscriptCount,
          apiKeyName: loaded?.settings?.apiKeyName ?? null,
          apiKeyStatus: loaded?.settings?.apiKeyStatus ?? null,
          storageStatus: loaded?.settings?.storageStatus ?? null,
          sessionSummary: document.querySelector("#sessionSummary")?.textContent ?? null,
          liveText: document.querySelector("#liveText")?.textContent ?? null,
          topSectionsTabRemoved: Array.from(document.querySelectorAll(".segmented button"), (button) => button.textContent?.trim()).includes("Sections") === false,
          settingsSummaryRemoved: document.querySelector("#settingsList") === null,
          protocolSummaryRemoved: document.querySelector("#protocolList") === null,
          inspectorNonProtocolSettingsRemoved: document.querySelector("#inspectorProvider, #inspectorMode, #endpointSwitch, #inspectorTranslationPolicy, #inspectorLlmProvider, #inspectorLlmModel") === null,
          inspectorProtocolSwitchCount: document.querySelectorAll(".inspector [data-protocol-switch]").length,
          protocolSwitchesEnabledInWarm: Array.from(document.querySelectorAll("[data-protocol-switch]")).every((control) => !control.disabled),
          nonProtocolSettingsDisabledInWarm: providerControl?.disabled === true && translationPolicyControl?.disabled === true,
          bodyScrolls: document.scrollingElement?.scrollHeight > document.scrollingElement?.clientHeight,
          shellOverflow: shell === null ? null : getComputedStyle(shell).overflow,
          timelineOverflowX: timeline === null ? null : getComputedStyle(timeline).overflowX,
          timelineOverflowY: timeline === null ? null : getComputedStyle(timeline).overflowY,
          timelineCanScroll,
          timelineNoHorizontalOverflow,
          transcriptStaysInsideMonitor,
          settingsOverflowY: settingsStyle?.overflowY ?? null,
          settingsCanScroll: settingsView === null ? false : settingsView.scrollHeight > settingsView.clientHeight,
          inspectorOverflowY: inspectorStyle?.overflowY ?? null,
          inspectorCanScroll: inspector === null ? false : inspector.scrollHeight > inspector.clientHeight,
          recentEventsOverflowX: recentEventsStyle?.overflowX ?? null,
          recentEventsNoHorizontalOverflow: recentEvents === null ? false : recentEvents.scrollWidth <= recentEvents.clientWidth + 1,
          inspectorEventsStayInside,
          inspectorGridRow: inspectorStyle?.gridRowStart + " / " + inspectorStyle?.gridRowEnd,
          captureGridColumn: captureBarStyle.gridColumnStart + " / " + captureBarStyle.gridColumnEnd
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
    !result.llmProviderControlExists ||
    !result.llmModelControlExists ||
    !result.clearTranscriptButtonExists ||
    recordingResult.statusText !== "Recording" ||
    recordingResult.toggleText !== "Stop Recording" ||
    recordingResult.shellState !== "recording" ||
    result.groupedTurnRowsBeforeClear !== 1 ||
    result.groupedBubbleTextsBeforeClear.length !== 3 ||
    result.groupedBubbleTextsBeforeClear[0] !== "Open the settings file and verify the API key." ||
    result.groupedStatusesBeforeClear[1] !== "refined" ||
    result.groupedStatusesBeforeClear[2] !== "translated" ||
    result.transcriptCountBeforeClear !== "3" ||
    result.liveTextBeforeClear !== "starting the next turn..." ||
    result.warmStatusText !== "Warm / Ready" ||
    result.warmToggleText !== "Stop Warm Session" ||
    result.warmShellState !== "warm" ||
    !result.clearEmptiedTimeline ||
    !result.clearResetLiveText ||
    !result.clearResetTranscriptCount ||
    result.timelineOverflowX !== "hidden" ||
    result.timelineOverflowY !== "auto" ||
    !result.timelineCanScroll ||
    !result.timelineNoHorizontalOverflow ||
    !result.transcriptStaysInsideMonitor ||
    !result.topSectionsTabRemoved ||
    !result.settingsSummaryRemoved ||
    !result.protocolSummaryRemoved ||
    !result.inspectorNonProtocolSettingsRemoved ||
    result.inspectorProtocolSwitchCount !== 4 ||
    !result.protocolSwitchesEnabledInWarm ||
    !result.nonProtocolSettingsDisabledInWarm ||
    result.settingsOverflowY !== "auto" ||
    !result.settingsCanScroll ||
    result.inspectorOverflowY !== "auto" ||
    !result.inspectorCanScroll ||
    result.recentEventsOverflowX !== "hidden" ||
    !result.recentEventsNoHorizontalOverflow ||
    !result.inspectorEventsStayInside ||
    result.inspectorGridRow !== "2 / auto" ||
    result.captureGridColumn !== "2 / 4"
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
