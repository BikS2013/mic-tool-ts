import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import { GlobalHotkeyManager } from "../src/ui/globalHotkeyManager.js";

const KEYS = Object.freeze({
  Backquote: 41,
  Quote: 40,
  Shift: 42,
  ShiftRight: 54,
  Alt: 56,
  AltRight: 3640,
  Ctrl: 29,
  CtrlRight: 3613,
  Meta: 3675,
  MetaRight: 3676,
});

class FakeHook extends EventEmitter {
  started = false;
  stopped = false;

  start(): void {
    this.started = true;
  }

  stop(): void {
    this.stopped = true;
  }
}

class FakeGlobalShortcut {
  readonly callbacks = new Map<string, () => void>();
  readonly register = vi.fn((accelerator: string, callback: () => void): boolean => {
    this.callbacks.set(accelerator, callback);
    return true;
  });
  readonly unregister = vi.fn((accelerator: string): void => {
    this.callbacks.delete(accelerator);
  });

  trigger(accelerator: string): void {
    this.callbacks.get(accelerator)?.();
  }
}

function nativeEvent(
  keycode: number,
  modifiers: Partial<{
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  }> = {},
) {
  return {
    keycode,
    altKey: modifiers.altKey ?? false,
    ctrlKey: modifiers.ctrlKey ?? false,
    metaKey: modifiers.metaKey ?? false,
    shiftKey: modifiers.shiftKey ?? false,
  };
}

describe("GlobalHotkeyManager", () => {
  it("starts on global Command+apostrophe down and stops on release", async () => {
    const hook = new FakeHook();
    const globalShortcut = new FakeGlobalShortcut();
    const onPress = vi.fn();
    const onRelease = vi.fn();
    const manager = new GlobalHotkeyManager({
      onPress,
      onRelease,
      onWarning: vi.fn(),
      globalShortcut,
      isMac: true,
      loadHookModule: async () => ({
        uIOhook: hook,
        UiohookKey: KEYS,
      }),
    });

    await manager.configure({ enabled: true, hotkey: "Command+'" });
    globalShortcut.trigger("Command+Quote");
    hook.emit("keydown", nativeEvent(KEYS.Quote, { metaKey: true }));
    hook.emit("keyup", nativeEvent(KEYS.Quote, { metaKey: true }));

    expect(hook.started).toBe(true);
    expect(globalShortcut.register).toHaveBeenCalledWith("Command+Quote", expect.any(Function));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it("releases an active hotkey session when disabled", async () => {
    const hook = new FakeHook();
    const onRelease = vi.fn();
    const manager = new GlobalHotkeyManager({
      onPress: vi.fn(),
      onRelease,
      onWarning: vi.fn(),
      isMac: true,
      loadHookModule: async () => ({
        uIOhook: hook,
        UiohookKey: KEYS,
      }),
    });

    await manager.configure({ enabled: true, hotkey: "Command+'" });
    hook.emit("keydown", nativeEvent(KEYS.Quote, { metaKey: true }));
    await manager.configure({ enabled: false, hotkey: "Command+'" });

    expect(onRelease).toHaveBeenCalledOnce();
    expect(hook.stopped).toBe(true);
  });

  it("warns and keeps UI usable when the native hook cannot load", async () => {
    const warning = vi.fn();
    const manager = new GlobalHotkeyManager({
      onPress: vi.fn(),
      onRelease: vi.fn(),
      onWarning: warning,
      loadHookModule: async () => {
        throw new Error("permission denied");
      },
    });

    await manager.configure({ enabled: true, hotkey: "Command+'" });

    expect(warning).toHaveBeenCalledWith(expect.stringContaining("permission denied"));
  });

  it("falls back to press-to-toggle when the native release hook cannot start", async () => {
    const globalShortcut = new FakeGlobalShortcut();
    const warning = vi.fn();
    const onPress = vi.fn();
    const onRelease = vi.fn();
    const manager = new GlobalHotkeyManager({
      onPress,
      onRelease,
      onWarning: warning,
      globalShortcut,
      loadHookModule: async () => {
        throw new Error("Input Monitoring permission denied");
      },
    });

    await manager.configure({ enabled: true, hotkey: "Command+'" });
    globalShortcut.trigger("Command+Quote");
    globalShortcut.trigger("Command+Quote");

    expect(warning).toHaveBeenCalledWith(expect.stringContaining("Input Monitoring permission denied"));
    expect(onPress).toHaveBeenCalledOnce();
    expect(onRelease).toHaveBeenCalledOnce();
  });

  it("warns when the system-wide shortcut cannot be reserved", async () => {
    const hook = new FakeHook();
    const warning = vi.fn();
    const globalShortcut = new FakeGlobalShortcut();
    globalShortcut.register.mockReturnValue(false);
    const manager = new GlobalHotkeyManager({
      onPress: vi.fn(),
      onRelease: vi.fn(),
      onWarning: warning,
      globalShortcut,
      loadHookModule: async () => ({
        uIOhook: hook,
        UiohookKey: KEYS,
      }),
    });

    await manager.configure({ enabled: true, hotkey: "Command+'" });

    expect(warning).toHaveBeenCalledWith(expect.stringContaining("could not be reserved"));
    expect(hook.started).toBe(true);
  });
});
