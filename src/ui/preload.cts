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
}

type SessionEvent = Record<string, unknown>;

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

  async stopSession(): Promise<void> {
    await ipcRenderer.invoke("mic-tool-ts:session:stop");
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
