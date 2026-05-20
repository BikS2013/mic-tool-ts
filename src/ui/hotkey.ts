export interface ParsedHotkey {
  readonly accelerator: string;
  readonly commandOrControl: boolean;
  readonly control: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly key: string;
}

export interface HotkeyKeyboardEventLike {
  readonly key: string;
  readonly code?: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly repeat?: boolean;
}

const MODIFIER_ORDER = ["CommandOrControl", "Control", "Command", "Alt", "Shift"] as const;
const KEY_ALIASES = new Map<string, string>([
  [" ", "Space"],
  ["`", "`"],
  ["'", "'"],
  ["Apostrophe", "'"],
  ["Grave", "`"],
  ["Backquote", "`"],
  ["Quote", "'"],
  ["SingleQuote", "'"],
  ["Spacebar", "Space"],
  ["Esc", "Escape"],
  ["Return", "Enter"],
  ["Up", "ArrowUp"],
  ["Down", "ArrowDown"],
  ["Left", "ArrowLeft"],
  ["Right", "ArrowRight"],
  ["Del", "Delete"],
]);

export function parseHotkeyAccelerator(accelerator: string): ParsedHotkey {
  const separator = accelerator.includes("+") ? "+" : "-";
  const parts = accelerator
    .split(separator)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new Error("Hotkey must not be empty");
  }

  const modifiers = {
    commandOrControl: false,
    control: false,
    meta: false,
    alt: false,
    shift: false,
  };
  let key: string | undefined;

  for (const part of parts) {
    const modifier = normalizeModifier(part);
    if (modifier !== null) {
      if (modifiers[modifier]) {
        throw new Error(`Duplicate hotkey modifier: ${part}`);
      }
      modifiers[modifier] = true;
      continue;
    }

    if (key !== undefined) {
      throw new Error(`Hotkey must contain exactly one non-modifier key: ${accelerator}`);
    }
    key = normalizeHotkeyKey(part);
  }

  if (key === undefined) {
    throw new Error(`Hotkey must include a non-modifier key: ${accelerator}`);
  }
  if (isModifierKey(key)) {
    throw new Error(`Hotkey key cannot be only a modifier: ${accelerator}`);
  }

  return {
    accelerator: formatHotkeyAccelerator({ ...modifiers, key }),
    ...modifiers,
    key,
  };
}

export function normalizeHotkeyAccelerator(accelerator: string): string {
  return parseHotkeyAccelerator(accelerator).accelerator;
}

export function eventMatchesHotkey(
  event: HotkeyKeyboardEventLike,
  hotkey: ParsedHotkey,
  isMac = isMacPlatform(),
): boolean {
  let key: string;
  try {
    key = eventKey(event);
  } catch {
    return false;
  }
  if (!hotkeyModifiersMatch(event, hotkey, isMac)) return false;
  return (
    key === hotkey.key
  );
}

export function eventMatchesHotkeyAccelerator(
  event: HotkeyKeyboardEventLike,
  accelerator: string,
  isMac = isMacPlatform(),
): boolean {
  return eventMatchesHotkey(event, parseHotkeyAccelerator(accelerator), isMac);
}

export function eventReleasesHotkey(
  event: HotkeyKeyboardEventLike,
  hotkey: ParsedHotkey,
  isMac = isMacPlatform(),
): boolean {
  if (eventMatchesHotkey(event, hotkey, isMac)) return true;
  const released = releasedKeyName(event);
  if (released === hotkey.key) return true;
  if (released === "Shift" && hotkey.shift) return true;
  if (released === "Alt" && hotkey.alt) return true;
  if (released === "Control" && (hotkey.control || hotkey.commandOrControl)) return true;
  if (released === "Command" && (hotkey.meta || (hotkey.commandOrControl && isMac))) return true;
  return false;
}

export function hotkeyModifiersMatch(
  event: HotkeyKeyboardEventLike,
  hotkey: ParsedHotkey,
  isMac: boolean,
): boolean {
  if (event.altKey !== hotkey.alt || event.shiftKey !== hotkey.shift) return false;

  if (hotkey.commandOrControl) {
    if (hotkey.control || hotkey.meta) return false;
    if (isMac) {
      return (event.metaKey && !event.ctrlKey) || (event.ctrlKey && !event.metaKey);
    }
    return event.ctrlKey && !event.metaKey;
  }

  return event.ctrlKey === hotkey.control && event.metaKey === hotkey.meta;
}

function normalizeModifier(
  value: string,
): "commandOrControl" | "control" | "meta" | "alt" | "shift" | null {
  switch (value.trim().toLowerCase()) {
    case "commandorcontrol":
    case "cmdorctrl":
    case "commandorctrl":
      return "commandOrControl";
    case "control":
    case "ctrl":
      return "control";
    case "command":
    case "cmd":
    case "meta":
    case "super":
      return "meta";
    case "option":
    case "alt":
      return "alt";
    case "shift":
      return "shift";
    default:
      return null;
  }
}

function normalizeHotkeyKey(value: string): string {
  const trimmed = value.trim();
  const alias = KEY_ALIASES.get(trimmed);
  if (alias !== undefined) return alias;

  if (/^[a-z]$/i.test(trimmed)) return trimmed.toUpperCase();
  if (/^[0-9]$/.test(trimmed)) return trimmed;

  const upper = trimmed.toUpperCase();
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(upper)) return upper;

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("arrow")) {
    const direction = lower.slice("arrow".length);
    return `Arrow${title(direction)}`;
  }

  const canonical = title(lower);
  if (
    canonical === "Space" ||
    canonical === "Enter" ||
    canonical === "Escape" ||
    canonical === "Tab" ||
    canonical === "Backspace" ||
    canonical === "Delete" ||
    canonical === "Home" ||
    canonical === "End" ||
    canonical === "Pageup" ||
    canonical === "Pagedown"
  ) {
    return canonical === "Pageup" ? "PageUp" : canonical === "Pagedown" ? "PageDown" : canonical;
  }

  if (trimmed.length === 1 && !/\s/.test(trimmed)) return trimmed;
  throw new Error(`Unsupported hotkey key: ${value}`);
}

function formatHotkeyAccelerator(
  hotkey: Omit<ParsedHotkey, "accelerator">,
): string {
  const parts: string[] = [];
  for (const modifier of MODIFIER_ORDER) {
    if (modifier === "CommandOrControl" && hotkey.commandOrControl) parts.push(modifier);
    if (modifier === "Control" && hotkey.control) parts.push(modifier);
    if (modifier === "Command" && hotkey.meta) parts.push(modifier);
    if (modifier === "Alt" && hotkey.alt) parts.push(modifier);
    if (modifier === "Shift" && hotkey.shift) parts.push(modifier);
  }
  parts.push(hotkey.key);
  return parts.join("+");
}

function eventKey(event: HotkeyKeyboardEventLike): string {
  const code = event.code ?? "";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  if (code === "Quote") return "'";
  if (code === "Space") return "Space";
  return normalizeHotkeyKey(event.key);
}

function releasedKeyName(event: HotkeyKeyboardEventLike): string {
  switch (event.key) {
    case "Control":
    case "Ctrl":
      return "Control";
    case "Meta":
    case "Command":
    case "OS":
      return "Command";
    case "Alt":
    case "Option":
      return "Alt";
    case "Shift":
      return "Shift";
    default:
      try {
        return eventKey(event);
      } catch {
        return "";
      }
  }
}

function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

function isModifierKey(value: string): boolean {
  return (
    value === "Control" ||
    value === "Command" ||
    value === "CommandOrControl" ||
    value === "Alt" ||
    value === "Shift"
  );
}

function title(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}
