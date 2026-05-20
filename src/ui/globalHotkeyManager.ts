import {
  hotkeyModifiersMatch,
  parseHotkeyAccelerator,
  type HotkeyKeyboardEventLike,
  type ParsedHotkey,
} from "./hotkey.js";

interface NativeKeyboardEvent {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly keycode: number;
}

interface NativeHook {
  on(event: "keydown" | "keyup", listener: (event: NativeKeyboardEvent) => void): this;
  removeListener(event: "keydown" | "keyup", listener: (event: NativeKeyboardEvent) => void): this;
  start(): void;
  stop(): void;
}

interface NativeHookModule {
  readonly uIOhook: NativeHook;
  readonly UiohookKey: Record<string, number>;
}

interface GlobalShortcutAdapter {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

export interface GlobalHotkeySettings {
  readonly enabled: boolean;
  readonly hotkey: string;
}

export interface GlobalHotkeyManagerOptions {
  readonly onPress: () => void | Promise<void>;
  readonly onRelease: () => void | Promise<void>;
  readonly onWarning: (message: string) => void;
  readonly loadHookModule?: () => Promise<NativeHookModule>;
  readonly globalShortcut?: GlobalShortcutAdapter;
  readonly isMac?: boolean;
}

export class GlobalHotkeyManager {
  private readonly onPress: () => void | Promise<void>;
  private readonly onRelease: () => void | Promise<void>;
  private readonly onWarning: (message: string) => void;
  private readonly loadHookModule: () => Promise<NativeHookModule>;
  private readonly globalShortcut: GlobalShortcutAdapter | null;
  private readonly isMac: boolean;
  private hook: NativeHook | null = null;
  private keys: Record<string, number> | null = null;
  private hotkey: ParsedHotkey | null = null;
  private started = false;
  private pressed = false;
  private registeredShortcut: string | null = null;

  constructor(options: GlobalHotkeyManagerOptions) {
    this.onPress = options.onPress;
    this.onRelease = options.onRelease;
    this.onWarning = options.onWarning;
    this.loadHookModule = options.loadHookModule ?? loadUiohookModule;
    this.globalShortcut = options.globalShortcut ?? null;
    this.isMac = options.isMac ?? process.platform === "darwin";
  }

  get isRunning(): boolean {
    return this.started;
  }

  async configure(settings: GlobalHotkeySettings): Promise<void> {
    if (!settings.enabled) {
      this.hotkey = null;
      await this.releaseIfPressed();
      this.unregisterGlobalShortcut();
      this.stop();
      return;
    }

    let parsed: ParsedHotkey;
    try {
      parsed = parseHotkeyAccelerator(settings.hotkey);
    } catch (error) {
      this.onWarning(error instanceof Error ? error.message : String(error));
      return;
    }

    if (this.keys !== null) {
      try {
        nativeKeycodeForHotkeyKey(parsed.key, this.keys);
      } catch (error) {
        this.onWarning(error instanceof Error ? error.message : String(error));
        return;
      }
    }
    this.hotkey = parsed;
    this.registerGlobalShortcut(parsed);
    if (this.started) return;

    try {
      const module = await this.loadHookModule();
      nativeKeycodeForHotkeyKey(parsed.key, module.UiohookKey);
      this.hook = module.uIOhook;
      this.keys = module.UiohookKey;
      this.hook.on("keydown", this.handleKeyDown);
      this.hook.on("keyup", this.handleKeyUp);
      this.hook.start();
      this.started = true;
    } catch (error) {
      this.hook = null;
      this.keys = null;
      this.started = false;
      this.onWarning(
        [
          "System-wide push-to-talk hotkey could not start.",
          error instanceof Error ? error.message : String(error),
          "Focused-window hotkey handling remains available.",
        ].join(" "),
      );
    }
  }

  stop(): void {
    this.unregisterGlobalShortcut();
    if (!this.started || this.hook === null) return;
    this.hook.removeListener("keydown", this.handleKeyDown);
    this.hook.removeListener("keyup", this.handleKeyUp);
    try {
      this.hook.stop();
    } catch (error) {
      this.onWarning(
        `System-wide push-to-talk hotkey could not stop cleanly: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    this.hook = null;
    this.keys = null;
    this.started = false;
    this.pressed = false;
  }

  private readonly handleKeyDown = (event: NativeKeyboardEvent): void => {
    if (this.hotkey === null || this.keys === null) return;
    if (!nativeEventMatchesHotkey(event, this.hotkey, this.keys, this.isMac)) return;
    this.press();
  };

  private readonly handleKeyUp = (event: NativeKeyboardEvent): void => {
    if (this.hotkey === null || this.keys === null || !this.pressed) return;
    if (!nativeEventReleasesHotkey(event, this.hotkey, this.keys, this.isMac)) return;
    void this.release();
  };

  private async releaseIfPressed(): Promise<void> {
    if (!this.pressed) return;
    await this.release();
  }

  private press(): void {
    if (this.pressed) return;
    this.pressed = true;
    void this.onPress();
  }

  private async release(): Promise<void> {
    this.pressed = false;
    await this.onRelease();
  }

  private readonly handleGlobalShortcut = (): void => {
    if (this.started) {
      this.press();
      return;
    }
    if (this.pressed) {
      void this.release();
      return;
    }
    this.press();
  };

  private registerGlobalShortcut(hotkey: ParsedHotkey): void {
    if (this.globalShortcut === null) return;
    const candidates = electronAcceleratorCandidates(hotkey);
    if (this.registeredShortcut !== null && candidates.includes(this.registeredShortcut)) {
      return;
    }
    this.unregisterGlobalShortcut();

    for (const candidate of candidates) {
      try {
        if (this.globalShortcut.register(candidate, this.handleGlobalShortcut)) {
          this.registeredShortcut = candidate;
          return;
        }
      } catch {
        // Try the next spelling; Electron accelerator support for punctuation differs by key.
      }
    }
    this.onWarning(
      `System-wide push-to-talk hotkey could not be reserved: ${hotkey.accelerator}. ` +
        "The native observer fallback remains active, but the foreground app may still receive the key.",
    );
  }

  private unregisterGlobalShortcut(): void {
    if (this.globalShortcut === null || this.registeredShortcut === null) return;
    this.globalShortcut.unregister(this.registeredShortcut);
    this.registeredShortcut = null;
  }
}

export function nativeEventMatchesHotkey(
  event: NativeKeyboardEvent,
  hotkey: ParsedHotkey,
  keys: Record<string, number>,
  isMac: boolean,
): boolean {
  return (
    nativeKeycodeForHotkeyKey(hotkey.key, keys) === event.keycode &&
    hotkeyModifiersMatch(toKeyboardEventLike(event), hotkey, isMac)
  );
}

export function nativeEventReleasesHotkey(
  event: NativeKeyboardEvent,
  hotkey: ParsedHotkey,
  keys: Record<string, number>,
  isMac: boolean,
): boolean {
  if (nativeEventMatchesHotkey(event, hotkey, keys, isMac)) return true;
  const primary = nativeKeycodeForHotkeyKey(hotkey.key, keys);
  if (event.keycode === primary) return true;
  if (hotkey.shift && (event.keycode === keys.Shift || event.keycode === keys.ShiftRight)) return true;
  if (hotkey.alt && (event.keycode === keys.Alt || event.keycode === keys.AltRight)) return true;
  if (
    (hotkey.control || hotkey.commandOrControl) &&
    (event.keycode === keys.Ctrl || event.keycode === keys.CtrlRight)
  ) {
    return true;
  }
  if (
    (hotkey.meta || (hotkey.commandOrControl && isMac)) &&
    (event.keycode === keys.Meta || event.keycode === keys.MetaRight)
  ) {
    return true;
  }
  return false;
}

export function nativeKeycodeForHotkeyKey(
  key: string,
  keys: Record<string, number>,
): number {
  const nativeKey = key === "`" ? "Backquote" : key === "'" ? "Quote" : key;
  const keycode = keys[nativeKey];
  if (typeof keycode !== "number") {
    throw new Error(`System-wide hotkey does not support key: ${key}`);
  }
  return keycode;
}

function toKeyboardEventLike(event: NativeKeyboardEvent): HotkeyKeyboardEventLike {
  return {
    key: "",
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
  };
}

function electronAcceleratorCandidates(hotkey: ParsedHotkey): string[] {
  const base = electronAcceleratorForHotkey(hotkey);
  if (hotkey.key === "'") {
    return unique([base.replace(/\+'$/, "+Quote"), base, base.replace(/\+'$/, "+Apostrophe")]);
  }
  if (hotkey.key === "`") {
    return unique([base.replace(/\+`$/, "+Backquote"), base]);
  }
  return [base];
}

function electronAcceleratorForHotkey(hotkey: ParsedHotkey): string {
  return hotkey.accelerator;
}

function unique(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

async function loadUiohookModule(): Promise<NativeHookModule> {
  return await import("uiohook-napi") as unknown as NativeHookModule;
}
