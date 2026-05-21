import type { SessionEvent } from "../core/sessionEvents.js";
import type { OperatorState } from "../protocol/types.js";

const WAITING_TEXT = "Waiting for audio...";
const FINAL_LINGER_MS = 1100;
const PROCESSED_LINGER_MS = 1300;
const WARNING_LINGER_MS = 1800;
const ERROR_LINGER_MS = 2200;

export type OverlayPhase =
  | "hidden"
  | "recording"
  | "finalizing"
  | "processed"
  | "warning"
  | "error";

export type OverlayTone = "neutral" | "recording" | "success" | "warning" | "error";

export interface OverlaySnapshot {
  readonly visible: boolean;
  readonly phase: OverlayPhase;
  readonly tone: OverlayTone;
  readonly label: string;
  readonly detail: string;
  readonly text: string;
  readonly hotkey: string;
  readonly protocolFeatures: OperatorState;
}

export interface OverlayState {
  readonly visible: boolean;
  readonly phase: OverlayPhase;
  readonly isRecording: boolean;
  readonly text: string;
  readonly hotkey: string;
  readonly protocolFeatures: OperatorState;
}

export type OverlayAction =
  | { readonly kind: "none" }
  | { readonly kind: "show" }
  | { readonly kind: "hide" }
  | { readonly kind: "schedule-hide"; readonly delayMs: number };

export interface OverlayEventContext {
  readonly hotkeyOwned: boolean;
  readonly hotkey: string;
  readonly protocolFeatures?: OperatorState;
}

export interface OverlayTransition {
  readonly state: OverlayState;
  readonly snapshot: OverlaySnapshot;
  readonly action: OverlayAction;
}

export interface WorkAreaLike {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type OverlayBounds = WorkAreaLike;

const DEFAULT_PROTOCOL_FEATURES: OperatorState = {
  refine: false,
  translate: false,
  clipboard: false,
  input: false,
};

export interface OverlayBoundsOptions {
  readonly targetWidth?: number;
  readonly targetHeight?: number;
  readonly margin?: number;
}

export function initialOverlayState(hotkey = ""): OverlayState {
  return {
    visible: false,
    phase: "hidden",
    isRecording: false,
    text: "",
    hotkey,
    protocolFeatures: { ...DEFAULT_PROTOCOL_FEATURES },
  };
}

export function reduceOverlayEvent(
  state: OverlayState,
  event: SessionEvent,
  context: OverlayEventContext,
): OverlayTransition {
  const current = {
    ...state,
    hotkey: context.hotkey,
    protocolFeatures: context.protocolFeatures ?? state.protocolFeatures,
  };

  if (!context.hotkeyOwned) {
    return reduceNonHotkeyEvent(current, event);
  }

  switch (event.type) {
    case "capture.state":
      if (event.state === "recording") {
        return transition({
          visible: true,
          phase: "recording",
        isRecording: true,
        text: WAITING_TEXT,
        hotkey: context.hotkey,
        protocolFeatures: current.protocolFeatures,
      }, { kind: "show" });
      }
      if (event.state === "warm") {
        if (!current.visible) return unchanged(current);
        return transition({
          ...current,
          visible: true,
          phase: "finalizing",
          isRecording: false,
          text: visibleText(current.text),
        }, { kind: "schedule-hide", delayMs: FINAL_LINGER_MS });
      }
      return hideTransition(context.hotkey);

    case "transcript.partial":
      if (!current.visible) return unchanged(current);
      return transition({
        ...current,
        visible: true,
        phase: current.isRecording ? "recording" : "finalizing",
        text: visibleText(event.text),
      }, { kind: "show" });

    case "transcript.final":
      return transition({
        ...current,
        visible: true,
        phase: current.isRecording ? "recording" : "finalizing",
        isRecording: current.isRecording,
        text: visibleText(event.text, current.text),
      }, hideAfterRecording(current, FINAL_LINGER_MS));

    case "transcript.refined":
      if (!current.visible) return unchanged(current);
      return transition({
        ...current,
        visible: true,
        phase: current.isRecording ? "recording" : "processed",
        isRecording: current.isRecording,
        text: visibleText(event.text, current.text),
      }, hideAfterRecording(current, PROCESSED_LINGER_MS));

    case "diagnostic.warning":
      return transition({
        ...current,
        visible: true,
        phase: current.isRecording ? "recording" : "warning",
        isRecording: current.isRecording,
        text: visibleText(event.message, current.text),
      }, hideAfterRecording(current, WARNING_LINGER_MS));

    case "session.error":
      return transition({
        ...current,
        visible: true,
        phase: "error",
        isRecording: false,
        text: visibleText(event.message, current.text),
      }, { kind: "schedule-hide", delayMs: ERROR_LINGER_MS });

    case "protocol.event":
      if (event.event.type !== "state.changed") return unchanged(current);
      return transition({
        ...current,
        protocolFeatures: {
          ...current.protocolFeatures,
          [event.event.key]: event.event.value,
        },
      }, current.visible ? { kind: "show" } : { kind: "none" });

    case "session.state":
      if (event.state === "error") {
        return transition({
          ...current,
          visible: true,
          phase: "error",
          isRecording: false,
          text: visibleText(event.reason, current.text),
        }, { kind: "schedule-hide", delayMs: ERROR_LINGER_MS });
      }
      if (event.state === "stopped" || event.state === "idle") {
        return current.visible ? hideTransition(context.hotkey) : unchanged(current);
      }
      return unchanged(current);

    default:
      return unchanged(current);
  }
}

export function overlaySnapshot(state: OverlayState): OverlaySnapshot {
  const labelByPhase: Record<OverlayPhase, string> = {
    hidden: "IDLE",
    recording: "LIVE",
    finalizing: "FINAL",
    processed: "PROCESSED",
    warning: "WARNING",
    error: "ERROR",
  };
  const detailByPhase: Record<OverlayPhase, string> = {
    hidden: "Idle",
    recording: "Recording",
    finalizing: "Finishing",
    processed: "Processed",
    warning: "Needs attention",
    error: "Capture stopped",
  };
  const toneByPhase: Record<OverlayPhase, OverlayTone> = {
    hidden: "neutral",
    recording: "recording",
    finalizing: "success",
    processed: "success",
    warning: "warning",
    error: "error",
  };

  return {
    visible: state.visible,
    phase: state.phase,
    tone: toneByPhase[state.phase],
    label: labelByPhase[state.phase],
    detail: detailByPhase[state.phase],
    text: state.visible ? visibleText(state.text) : "",
    hotkey: state.hotkey,
    protocolFeatures: { ...state.protocolFeatures },
  };
}

export function calculateOverlayBounds(
  workArea: WorkAreaLike,
  options: OverlayBoundsOptions = {},
): OverlayBounds {
  const margin = options.margin ?? 24;
  const targetWidth = options.targetWidth ?? 940;
  const targetHeight = options.targetHeight ?? 128;
  const availableWidth = Math.max(240, workArea.width - (margin * 2));
  const availableHeight = Math.max(72, workArea.height - (margin * 2));
  const width = Math.round(Math.min(targetWidth, availableWidth));
  const height = Math.round(Math.min(targetHeight, availableHeight));
  const x = Math.round(workArea.x + ((workArea.width - width) / 2));
  const y = Math.round(workArea.y + workArea.height - height - margin);

  return {
    x,
    y: Math.max(workArea.y + margin, y),
    width,
    height,
  };
}

function reduceNonHotkeyEvent(state: OverlayState, event: SessionEvent): OverlayTransition {
  if (!state.visible) return unchanged(state);
  if (event.type === "capture.state" && event.state === "idle") {
    return hideTransition(state.hotkey);
  }
  if (event.type === "session.error") {
    return transition({
      ...state,
      visible: true,
      phase: "error",
      isRecording: false,
      text: visibleText(event.message, state.text),
    }, { kind: "schedule-hide", delayMs: ERROR_LINGER_MS });
  }
  if (
    event.type === "session.state" &&
    (event.state === "idle" || event.state === "stopped" || event.state === "error")
  ) {
    return event.state === "error"
      ? transition({
        ...state,
        visible: true,
        phase: "error",
        isRecording: false,
        text: visibleText(event.reason, state.text),
      }, { kind: "schedule-hide", delayMs: ERROR_LINGER_MS })
      : hideTransition(state.hotkey);
  }
  return unchanged(state);
}

function unchanged(state: OverlayState): OverlayTransition {
  return transition(state, { kind: "none" });
}

function transition(state: OverlayState, action: OverlayAction): OverlayTransition {
  return {
    state,
    snapshot: overlaySnapshot(state),
    action,
  };
}

function hideAfterRecording(state: OverlayState, delayMs: number): OverlayAction {
  return state.isRecording ? { kind: "show" } : { kind: "schedule-hide", delayMs };
}

function hideTransition(hotkey: string): OverlayTransition {
  const state = initialOverlayState(hotkey);
  return transition(state, { kind: "hide" });
}

function visibleText(text: string | undefined, fallback = WAITING_TEXT): string {
  const normalized = text?.trim() ?? "";
  const normalizedFallback = fallback.trim();
  if (normalized.length > 0) return normalized;
  return normalizedFallback.length > 0 ? normalizedFallback : WAITING_TEXT;
}
