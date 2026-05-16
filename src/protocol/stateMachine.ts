import type {
  MarkerConfig,
  OperatorKey,
  OperatorState,
  ProtocolSettingsSnapshot,
  ProtocolStatusReport,
  TranslationPolicy,
} from "./types.js";
import {
  consumeCommandArgs,
  findFirstMarker,
  normalizePayloadWhitespace,
  stripMarkersForDisplay,
  type MarkerDefinition,
} from "./markerMatcher.js";

export type ProtocolAction =
  | {
      type: "state.changed";
      key: OperatorKey;
      value: boolean;
      targetPolicy?: TranslationPolicy;
    }
  | ({
      type: "status.reported";
    } & ProtocolStatusReport)
  | {
      type: "section.submitted";
      sectionId: string;
      rawText: string;
      operators: OperatorKey[];
    }
  | {
      type: "section.cancelled";
      sectionId: string;
      reason: "spoken_cancel" | "shutdown";
    }
  | {
      type: "protocol.warning";
      message: string;
    }
  | {
      type: "section.empty";
    };

export interface StateMachineResult {
  visibleText: string;
  actions: ProtocolAction[];
}

export interface VoiceCommandStateMachineOptions {
  markers: MarkerConfig;
  initialOperators: OperatorState;
  translationPolicy: TranslationPolicy;
}

export class VoiceCommandStateMachine {
  private readonly markers: MarkerConfig;
  private readonly markerDefinitions: MarkerDefinition[];
  private readonly translationPolicy: TranslationPolicy;
  private operatorState: OperatorState;
  private buffer = "";
  private literalNextPending = false;
  private sectionCounter = 0;
  private currentSectionId: string | null = null;

  constructor(opts: VoiceCommandStateMachineOptions) {
    this.markers = opts.markers;
    this.markerDefinitions = buildMarkerDefinitions(opts.markers);
    this.operatorState = { ...opts.initialOperators };
    this.translationPolicy = opts.translationPolicy;
  }

  get state(): OperatorState {
    return { ...this.operatorState };
  }

  get settingsSnapshot(): ProtocolSettingsSnapshot {
    return {
      operators: { ...this.operatorState },
      translation_policy: this.translationPolicy,
    };
  }

  get statusReport(): ProtocolStatusReport {
    return this.statusReportForBuffer(this.buffer);
  }

  get definitions(): readonly MarkerDefinition[] {
    return this.markerDefinitions;
  }

  processFinal(text: string): StateMachineResult {
    const visibleText = stripMarkersForDisplay(text, this.markerDefinitions);
    this.appendToBuffer(text);

    const actions: ProtocolAction[] = [];
    let searchStart = 0;

    while (searchStart <= this.buffer.length) {
      const match = findFirstMarker(this.buffer, this.markerDefinitions, searchStart);
      if (match === null) break;

      if (this.literalNextPending && match.kind !== "literal_next") {
        this.literalNextPending = false;
        searchStart = match.end;
        continue;
      }

      if (match.kind === "literal_next") {
        this.buffer = `${this.buffer.slice(0, match.start)} ${this.buffer.slice(match.end)}`;
        this.literalNextPending = true;
        searchStart = match.start;
        continue;
      }

      if (match.kind === "state_command") {
        const consumed = consumeCommandArgs(this.buffer, match.end);
        const nextBuffer = `${this.buffer.slice(0, match.start)} ${this.buffer.slice(consumed.end)}`;
        const action = this.applyCommand(
          consumed.operator,
          consumed.value,
          nextBuffer,
        );
        actions.push(action);
        this.buffer = nextBuffer;
        searchStart = match.start;
        continue;
      }

      if (match.kind === "section_end") {
        const rawText = normalizePayloadWhitespace(this.buffer.slice(0, match.start));
        const after = this.buffer.slice(match.end);
        if (rawText.length === 0) {
          actions.push({ type: "section.empty" });
          this.currentSectionId = null;
        } else {
          actions.push({
            type: "section.submitted",
            sectionId: this.currentSectionId ?? this.nextSectionId(),
            rawText,
            operators: this.activeOperators(),
          });
          this.currentSectionId = null;
        }
        this.buffer = normalizePayloadWhitespace(after);
        if (this.buffer.length > 0) this.ensureSectionId();
        searchStart = 0;
        continue;
      }

      if (match.kind === "section_cancel") {
        const rawText = normalizePayloadWhitespace(this.buffer.slice(0, match.start));
        const after = this.buffer.slice(match.end);
        if (rawText.length > 0) {
          actions.push({
            type: "section.cancelled",
            sectionId: this.currentSectionId ?? this.nextSectionId(),
            reason: "spoken_cancel",
          });
        }
        this.currentSectionId = null;
        this.buffer = normalizePayloadWhitespace(after);
        if (this.buffer.length > 0) this.ensureSectionId();
        searchStart = 0;
      }
    }

    return { visibleText, actions };
  }

  drainForShutdown(): ProtocolAction[] {
    const rawText = normalizePayloadWhitespace(this.buffer);
    if (rawText.length === 0) return [];
    const sectionId = this.currentSectionId ?? this.nextSectionId();
    this.buffer = "";
    this.currentSectionId = null;
    return [
      {
        type: "section.cancelled",
        sectionId,
        reason: "shutdown",
      },
    ];
  }

  private appendToBuffer(text: string): void {
    if (text.trim().length === 0) return;
    this.buffer = normalizePayloadWhitespace(
      this.buffer.length === 0 ? text : `${this.buffer} ${text}`,
    );
    this.ensureSectionId();
  }

  private ensureSectionId(): string {
    if (this.currentSectionId === null) {
      this.currentSectionId = this.nextSectionId();
    }
    return this.currentSectionId;
  }

  private nextSectionId(): string {
    this.sectionCounter += 1;
    return `sec_${String(this.sectionCounter).padStart(6, "0")}`;
  }

  private applyCommand(
    operatorRaw: string | undefined,
    valueRaw: string | undefined,
    nextBuffer: string,
  ): ProtocolAction {
    const operator = operatorRaw?.toLowerCase();
    const value = valueRaw?.toLowerCase();
    if (operator === "status") {
      if (value !== undefined) {
        return {
          type: "protocol.warning",
          message: `Unknown protocol value for status: ${valueRaw ?? "<missing>"}. Expected no value.`,
        };
      }
      return {
        type: "status.reported",
        ...this.statusReportForBuffer(nextBuffer),
      };
    }
    if (!isOperatorKey(operator)) {
      return {
        type: "protocol.warning",
        message: `Unknown protocol operator: ${operatorRaw ?? "<missing>"}.`,
      };
    }
    if (value !== undefined && value !== "on" && value !== "off") {
      return {
        type: "protocol.warning",
        message: `Unknown protocol value for ${operator}: ${valueRaw ?? "<missing>"}. Expected on or off.`,
      };
    }

    const enabled = value === undefined ? true : value === "on";
    this.operatorState = {
      ...this.operatorState,
      [operator]: enabled,
    };
    return {
      type: "state.changed",
      key: operator,
      value: enabled,
      targetPolicy: operator === "translate" ? this.translationPolicy : undefined,
    };
  }

  private activeOperators(): OperatorKey[] {
    const keys: OperatorKey[] = [];
    if (this.operatorState.refine) keys.push("refine");
    if (this.operatorState.translate) keys.push("translate");
    if (this.operatorState.clipboard) keys.push("clipboard");
    return keys;
  }

  private statusReportForBuffer(buffer: string): ProtocolStatusReport {
    return {
      ...this.settingsSnapshot,
      pending_section: normalizePayloadWhitespace(buffer).length > 0,
    };
  }
}

function buildMarkerDefinitions(markers: MarkerConfig): MarkerDefinition[] {
  return [
    {
      kind: "state_command",
      phrases: [markers.commandPhrase],
    },
    {
      kind: "section_end",
      phrases: unique([
        markers.sectionEndPhrase,
        ...markers.sectionEndAliases,
      ]),
    },
    {
      kind: "section_cancel",
      phrases: [markers.sectionCancelPhrase],
    },
    {
      kind: "literal_next",
      phrases: [markers.literalNextPhrase],
    },
  ];
}

function unique(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length === 0) continue;
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

function isOperatorKey(value: string | undefined): value is OperatorKey {
  return value === "refine" || value === "translate" || value === "clipboard";
}
