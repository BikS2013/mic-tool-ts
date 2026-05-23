import type { IpcRendererEvent } from "electron";

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

type SessionEvent = Record<string, unknown>;
type OverlaySnapshot = Record<string, unknown>;
type OperatorKey = "refine" | "translate" | "clipboard" | "input";
interface StopSessionOptions {
  submitPending?: boolean;
}
interface StartSessionOptions {
  hotkey?: boolean;
}

const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

const api = {
  async loadSettings(): Promise<unknown> {
    return ipcRenderer.invoke("untype:settings:load");
  },

  async updateSettings(settings: Partial<RendererSettings>): Promise<unknown> {
    return ipcRenderer.invoke("untype:settings:update", settings);
  },

  async startSession(options?: StartSessionOptions): Promise<void> {
    await ipcRenderer.invoke("untype:session:start", options ?? {});
  },

  async stopSession(options?: StopSessionOptions): Promise<void> {
    await ipcRenderer.invoke("untype:session:stop", options ?? {});
  },

  async toggleProtocolFeature(key: OperatorKey): Promise<void> {
    await ipcRenderer.invoke("untype:protocol:toggle", key);
  },

  onSessionEvent(callback: (event: SessionEvent) => void): () => void {
    const listener = (_event: IpcRendererEvent, payload: SessionEvent): void => {
      callback(payload);
    };
    ipcRenderer.on("untype:session:event", listener);
    return () => {
      ipcRenderer.off("untype:session:event", listener);
    };
  },

  onOverlaySnapshot(callback: (snapshot: OverlaySnapshot) => void): () => void {
    const listener = (_event: IpcRendererEvent, payload: OverlaySnapshot): void => {
      callback(payload);
    };
    ipcRenderer.on("untype:overlay:snapshot", listener);
    return () => {
      ipcRenderer.off("untype:overlay:snapshot", listener);
    };
  },
};

contextBridge.exposeInMainWorld("untype", api);
