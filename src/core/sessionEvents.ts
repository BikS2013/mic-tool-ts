import type { ResolvedConfig } from "../config.js";
import type { EnvSource } from "../config/envChain.js";
import type { ProtocolEvent } from "../protocol/types.js";

export type SessionState =
  | "idle"
  | "starting"
  | "listening"
  | "stopping"
  | "stopped"
  | "error";

export interface SafeConfigSummary {
  readonly sttProvider: ResolvedConfig["sttProvider"];
  readonly apiKeyEnvName: ResolvedConfig["apiKeyEnvName"];
  readonly apiKeyConfigured: boolean;
  readonly apiKeySource: EnvSource;
  readonly apiKeyExpiresAt?: string;
  readonly model: string;
  readonly endpoint: string;
  readonly languages: readonly string[];
  readonly sampleRate: number;
  readonly enableEndpointDetection: boolean;
  readonly outputMode: ResolvedConfig["outputMode"];
  readonly guardPhrase: string;
  readonly interactionMode: ResolvedConfig["protocol"]["interactionMode"];
  readonly operators: ResolvedConfig["protocol"]["initialOperators"];
  readonly translationPolicy: ResolvedConfig["protocol"]["translationPolicy"];
  readonly llmEnabled: boolean;
  readonly llmProvider: ResolvedConfig["llm"]["provider"];
  readonly llmModel: string;
  readonly verbose: boolean;
}

export type SessionEvent =
  | {
      readonly type: "session.state";
      readonly state: SessionState;
      readonly reason?: string;
    }
  | {
      readonly type: "session.ready";
      readonly message: string;
    }
  | {
      readonly type: "session.error";
      readonly code: string;
      readonly message: string;
      readonly exitCode: number;
    }
  | {
      readonly type: "config.loaded";
      readonly config: SafeConfigSummary;
    }
  | {
      readonly type: "config.saved";
      readonly message?: string;
    }
  | {
      readonly type: "transcript.partial";
      readonly text: string;
    }
  | {
      readonly type: "transcript.final";
      readonly text: string;
    }
  | {
      readonly type: "transcript.turnBoundary";
    }
  | {
      readonly type: "transcript.refined";
      readonly text: string;
    }
  | {
      readonly type: "protocol.event";
      readonly event: ProtocolEvent;
    }
  | {
      readonly type: "diagnostic.info" | "diagnostic.warning";
      readonly message: string;
    };

export type SessionEventSink = (event: SessionEvent) => void;

export function safeConfigSummary(config: ResolvedConfig): SafeConfigSummary {
  return {
    sttProvider: config.sttProvider,
    apiKeyEnvName: config.apiKeyEnvName,
    apiKeyConfigured: config.apiKey.trim().length > 0,
    apiKeySource: config.apiKeySource,
    apiKeyExpiresAt: config.apiKeyExpiresAt,
    model: config.model,
    endpoint: config.endpoint,
    languages: config.languages,
    sampleRate: config.sampleRate,
    enableEndpointDetection: config.enableEndpointDetection,
    outputMode: config.outputMode,
    guardPhrase: config.guardPhrase,
    interactionMode: config.protocol.interactionMode,
    operators: config.protocol.initialOperators,
    translationPolicy: config.protocol.translationPolicy,
    llmEnabled: config.llm.enabled,
    llmProvider: config.llm.provider,
    llmModel: config.llm.model,
    verbose: config.verbose,
  };
}
