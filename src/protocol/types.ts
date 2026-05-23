import type { Writable } from "node:stream";

export type InteractionMode = "dictation" | "agent-protocol" | "hybrid";

export const INTERACTION_MODES: readonly InteractionMode[] = [
  "dictation",
  "agent-protocol",
  "hybrid",
] as const;

export type TranslationPolicy = "opposite" | "to-en" | "to-el";

export const TRANSLATION_POLICIES: readonly TranslationPolicy[] = [
  "opposite",
  "to-en",
  "to-el",
] as const;

export type OperatorKey = "refine" | "translate" | "clipboard" | "input";

export interface OperatorState {
  refine: boolean;
  translate: boolean;
  clipboard: boolean;
  input: boolean;
}

export type ProtocolSettingSource = "configured" | "default";

export interface ProtocolSettingSources {
  operators: {
    refine: ProtocolSettingSource;
    translate: ProtocolSettingSource;
    clipboard: ProtocolSettingSource;
    input: ProtocolSettingSource;
  };
  translationPolicy: ProtocolSettingSource;
}

export interface ProtocolSettingsSnapshot {
  operators: OperatorState;
  translation_policy: TranslationPolicy;
}

export interface ProtocolStatusReport extends ProtocolSettingsSnapshot {
  pending_section: boolean;
}

export interface MarkerConfig {
  commandPhrase: string;
  sectionEndPhrase: string;
  sectionEndAliases: readonly string[];
  sectionCancelPhrase: string;
  literalNextPhrase: string;
}

export interface ProtocolRuntimeConfig {
  interactionMode: InteractionMode;
  markers: MarkerConfig;
  initialOperators: OperatorState;
  translationPolicy: TranslationPolicy;
  protocolOutput?: string;
  settingSources: ProtocolSettingSources;
}

export type ProtocolEvent =
  | {
      type: "session.started";
      protocol: "untype.voice-agent.v1";
    }
  | {
      type: "session.ended";
      reason: string;
    }
  | {
      type: "state.changed";
      key: OperatorKey;
      value: boolean;
      target_policy?: TranslationPolicy;
    }
  | ({
      type: "status.reported";
    } & ProtocolStatusReport)
  | {
      type: "section.submitted";
      section_id: string;
      raw_text: string;
    }
  | {
      type: "section.processed";
      section_id: string;
      operators: OperatorKey[];
      raw_text: string;
      refined_text?: string;
      source_language?: "el" | "en";
      target_language?: "el" | "en";
      output_text: string;
    }
  | {
      type: "clipboard.copied";
      section_id: string;
    }
  | {
      type: "input.sent";
      section_id: string;
    }
  | {
      type: "section.cancelled";
      section_id: string;
      reason: "spoken_cancel" | "shutdown";
    }
  | {
      type: "protocol.warning";
      message: string;
    };

export type SequencedProtocolEvent = ProtocolEvent & { seq: number };

export interface ProtocolWriter {
  write(event: ProtocolEvent): void;
  end(): void;
}

export interface ProtocolWriterOptions {
  out: Writable;
  closeOnEnd?: boolean;
}
