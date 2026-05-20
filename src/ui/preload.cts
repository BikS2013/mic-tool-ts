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
interface StopSessionOptions {
  submitPending?: boolean;
}

const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

const api = {
  async loadSettings(): Promise<unknown> {
    return ipcRenderer.invoke("mic-tool-ts:settings:load");
  },

  async updateSettings(settings: Partial<RendererSettings>): Promise<unknown> {
    return ipcRenderer.invoke("mic-tool-ts:settings:update", settings);
  },

  async startSession(): Promise<void> {
    await ipcRenderer.invoke("mic-tool-ts:session:start");
  },

  async stopSession(options?: StopSessionOptions): Promise<void> {
    await ipcRenderer.invoke("mic-tool-ts:session:stop", options ?? {});
  },

  onSessionEvent(callback: (event: SessionEvent) => void): () => void {
    const listener = (_event: IpcRendererEvent, payload: SessionEvent): void => {
      callback(payload);
    };
    ipcRenderer.on("mic-tool-ts:session:event", listener);
    return () => {
      ipcRenderer.off("mic-tool-ts:session:event", listener);
    };
  },
};

contextBridge.exposeInMainWorld("micToolTs", api);
