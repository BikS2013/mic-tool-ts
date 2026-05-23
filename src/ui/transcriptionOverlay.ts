import { BrowserWindow, screen } from "electron";

import type { SessionEvent } from "../core/sessionEvents.js";
import {
  calculateOverlayBounds,
  initialOverlayState,
  overlayDiagnosticSummary,
  overlaySnapshot,
  reduceOverlayEvent,
  type OverlayAction,
  type OverlayEventContext,
  type OverlaySnapshot,
  type OverlayState,
} from "./transcriptionOverlayState.js";

interface TranscriptionOverlayManagerOptions {
  readonly preloadPath: string;
  readonly rendererPath: string;
  readonly devTools?: boolean;
  readonly onDiagnostic?: (message: string) => void;
}

export class TranscriptionOverlayManager {
  private readonly preloadPath: string;
  private readonly rendererPath: string;
  private readonly devTools: boolean;
  private readonly onDiagnostic: ((message: string) => void) | undefined;
  private window: BrowserWindow | null = null;
  private windowLoad: Promise<BrowserWindow> | null = null;
  private hideTimer: NodeJS.Timeout | undefined;
  private actionVersion = 0;
  private state: OverlayState = initialOverlayState();

  constructor(options: TranscriptionOverlayManagerOptions) {
    this.preloadPath = options.preloadPath;
    this.rendererPath = options.rendererPath;
    this.devTools = options.devTools ?? true;
    this.onDiagnostic = options.onDiagnostic;
    screen.on("display-metrics-changed", this.repositionIfVisible);
    screen.on("display-added", this.repositionIfVisible);
    screen.on("display-removed", this.repositionIfVisible);
  }

  handleSessionEvent(event: SessionEvent, context: OverlayEventContext): void {
    const transition = reduceOverlayEvent(this.state, event, context);
    this.state = transition.state;
    if (transition.action.kind !== "none") {
      this.onDiagnostic?.(overlayDiagnosticSummary(
        event,
        context,
        transition.snapshot,
        transition.action,
      ));
    }
    this.applyAction(transition.snapshot, transition.action);
  }

  hideNow(): void {
    this.actionVersion += 1;
    this.clearHideTimer();
    this.state = initialOverlayState(this.state.hotkey);
    const snapshot = overlaySnapshot(this.state);
    this.sendSnapshot(snapshot);
    this.window?.hide();
  }

  destroy(): void {
    this.clearHideTimer();
    screen.off("display-metrics-changed", this.repositionIfVisible);
    screen.off("display-added", this.repositionIfVisible);
    screen.off("display-removed", this.repositionIfVisible);
    if (this.window !== null && !this.window.isDestroyed()) {
      this.window.destroy();
    }
    this.window = null;
    this.windowLoad = null;
    this.state = initialOverlayState(this.state.hotkey);
  }

  private readonly repositionIfVisible = (): void => {
    if (this.window === null || this.window.isDestroyed() || !this.window.isVisible()) return;
    this.positionWindow();
  };

  private applyAction(snapshot: OverlaySnapshot, action: OverlayAction): void {
    switch (action.kind) {
      case "none":
        if (snapshot.visible) {
          this.sendSnapshot(snapshot);
        }
        return;
      case "show":
        this.clearHideTimer();
        void this.showSnapshot(snapshot, this.nextActionVersion());
        return;
      case "schedule-hide":
        void this.showSnapshot(snapshot, this.nextActionVersion());
        this.scheduleHide(action.delayMs, this.actionVersion);
        return;
      case "hide":
        this.hideNow();
        return;
    }
  }

  private async showSnapshot(snapshot: OverlaySnapshot, actionVersion: number): Promise<void> {
    const overlayWindow = await this.ensureWindow();
    if (actionVersion !== this.actionVersion) return;
    if (overlayWindow.isDestroyed()) return;
    this.positionWindow();
    this.sendSnapshot(snapshot);
    if (!overlayWindow.isVisible()) {
      overlayWindow.showInactive();
    }
  }

  private async ensureWindow(): Promise<BrowserWindow> {
    if (this.window !== null && !this.window.isDestroyed()) {
      return this.windowLoad ?? Promise.resolve(this.window);
    }

    const overlayWindow = new BrowserWindow({
      width: 940,
      height: 128,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      alwaysOnTop: true,
      webPreferences: {
        preload: this.preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        devTools: this.devTools,
      },
    });
    this.window = overlayWindow;
    overlayWindow.setAlwaysOnTop(true, "floating");
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    overlayWindow.on("closed", () => {
      if (this.window === overlayWindow) {
        this.window = null;
        this.windowLoad = null;
      }
    });
    this.windowLoad = overlayWindow.loadFile(this.rendererPath).then(() => overlayWindow);
    return this.windowLoad;
  }

  private positionWindow(): void {
    if (this.window === null || this.window.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    this.window.setBounds(calculateOverlayBounds(display.workArea), false);
  }

  private sendSnapshot(snapshot: OverlaySnapshot): void {
    if (this.window === null || this.window.isDestroyed()) return;
    this.window.webContents.send("mic-tool-ts:overlay:snapshot", snapshot);
  }

  private scheduleHide(delayMs: number, actionVersion: number): void {
    this.clearHideTimer();
    this.hideTimer = setTimeout(() => {
      this.hideTimer = undefined;
      if (actionVersion !== this.actionVersion) return;
      this.hideNow();
    }, delayMs);
    this.hideTimer.unref?.();
  }

  private nextActionVersion(): number {
    this.actionVersion += 1;
    return this.actionVersion;
  }

  private clearHideTimer(): void {
    if (this.hideTimer === undefined) return;
    clearTimeout(this.hideTimer);
    this.hideTimer = undefined;
  }
}
