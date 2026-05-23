import { spawn } from "node:child_process";

import type { LLMRefiner } from "../llm/types.js";
import {
  FocusedInputDeliveryError,
  sendToFocusedInput,
} from "../platform/macos/focusedInputHelper.js";
import type { Renderer } from "../render/renderer.js";
import { LLMRefinementError } from "../errors.js";
import { VoiceCommandStateMachine, type ProtocolAction } from "./stateMachine.js";
import type {
  InteractionMode,
  MarkerConfig,
  OperatorKey,
  OperatorState,
  ProtocolEvent,
  ProtocolSettingsSnapshot,
  ProtocolWriter,
  TranslationPolicy,
} from "./types.js";

export interface VoiceAgentProtocolControllerOptions {
  mode: InteractionMode;
  renderer: Renderer;
  writer?: ProtocolWriter;
  markers: MarkerConfig;
  initialOperators: OperatorState;
  translationPolicy: TranslationPolicy;
  verbose?: boolean;
  refiner?: LLMRefiner | null;
  translator?: LLMRefiner | null;
  clipboardWriter?: (text: string) => Promise<void>;
  inputWriter?: (text: string) => Promise<void>;
  diagnosticWriter?: (line: string, warning: boolean) => void;
}

export interface EndSessionOptions {
  readonly submitPending?: boolean;
}

export class VoiceAgentProtocolController {
  private readonly mode: InteractionMode;
  private readonly renderer: Renderer;
  private readonly writer: ProtocolWriter | null;
  private readonly stateMachine: VoiceCommandStateMachine;
  private readonly translationPolicy: TranslationPolicy;
  private readonly verbose: boolean;
  private readonly refiner: LLMRefiner | null;
  private readonly translator: LLMRefiner | null;
  private readonly clipboardWriter: (text: string) => Promise<void>;
  private readonly inputWriter: (text: string) => Promise<void>;
  private readonly diagnosticWriter: (line: string, warning: boolean) => void;
  private readonly inFlight = new Set<Promise<void>>();
  private sessionStarted = false;
  private sessionEnded = false;
  private disposed = false;

  constructor(opts: VoiceAgentProtocolControllerOptions) {
    this.mode = opts.mode;
    this.renderer = opts.renderer;
    this.writer = opts.writer ?? null;
    this.translationPolicy = opts.translationPolicy;
    this.verbose = opts.verbose ?? false;
    this.refiner = opts.refiner ?? null;
    this.translator = opts.translator ?? null;
    this.clipboardWriter = opts.clipboardWriter ?? copyToClipboard;
    this.inputWriter = opts.inputWriter ?? sendToFocusedInput;
    this.diagnosticWriter = opts.diagnosticWriter ?? ((line) => {
      process.stderr.write(line.endsWith("\n") ? line : `${line}\n`);
    });
    this.stateMachine = new VoiceCommandStateMachine({
      markers: opts.markers,
      initialOperators: opts.initialOperators,
      translationPolicy: opts.translationPolicy,
    });
  }

  startSession(): void {
    if (this.sessionStarted) return;
    this.sessionStarted = true;
    this.writeProtocol({
      type: "session.started",
      protocol: "untype.voice-agent.v1",
    });
  }

  partial(text: string): void {
    if (this.disposed) return;
    if (this.mode !== "agent-protocol") {
      this.renderer.partial(text);
    }
  }

  final(text: string): void {
    if (this.disposed) return;
    const result = this.stateMachine.processFinal(text);
    if (this.mode !== "agent-protocol" && result.visibleText.length > 0) {
      this.renderer.final(result.visibleText);
    }
    for (const action of result.actions) {
      this.handleAction(action);
    }
  }

  async endSession(reason: string, options: EndSessionOptions = {}): Promise<void> {
    if (this.sessionEnded) return;
    for (const action of this.stateMachine.drainForShutdown({
      submitPending: options.submitPending === true,
    })) {
      this.handleAction(action);
    }
    if (this.inFlight.size > 0) {
      await Promise.allSettled(Array.from(this.inFlight));
    }
    this.writeProtocol({
      type: "session.ended",
      reason,
    });
    this.writer?.end();
    this.sessionEnded = true;
  }

  async submitPending(): Promise<void> {
    if (this.sessionEnded || this.disposed) return;
    for (const action of this.stateMachine.drainForShutdown({ submitPending: true })) {
      this.handleAction(action);
    }
    if (this.inFlight.size > 0) {
      await Promise.allSettled(Array.from(this.inFlight));
    }
  }

  toggleOperator(key: OperatorKey): void {
    if (this.sessionEnded || this.disposed) return;
    this.handleAction(this.stateMachine.toggleOperator(key));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.refiner?.dispose();
    this.translator?.dispose();
    this.renderer.dispose();
  }

  settingsSnapshot(): ProtocolSettingsSnapshot {
    return this.stateMachine.settingsSnapshot;
  }

  private handleAction(action: ProtocolAction): void {
    switch (action.type) {
      case "state.changed": {
        this.writeProtocol({
          type: "state.changed",
          key: action.key,
          value: action.value,
          target_policy: action.targetPolicy,
        });
        if (this.verbose) {
          this.diagnosticWriter(
            `[untype] protocol state: ${action.key}=${action.value ? "on" : "off"}`,
            false,
          );
        }
        return;
      }
      case "status.reported": {
        this.writeProtocol({
          type: "status.reported",
          operators: action.operators,
          translation_policy: action.translation_policy,
          pending_section: action.pending_section,
        });
        if (this.mode !== "agent-protocol") {
          this.renderer.refined(formatStatusReport(action));
        }
        if (this.verbose) {
          this.diagnosticWriter(
            `[untype] protocol status: ${formatStatusSummary(action)}`,
            false,
          );
        }
        return;
      }
      case "section.submitted": {
        this.writeProtocol({
          type: "section.submitted",
          section_id: action.sectionId,
          raw_text: action.rawText,
        });
        if (this.mode !== "agent-protocol") {
          this.renderer.turnBoundary();
        }
        const task = this.processSection(action);
        this.inFlight.add(task);
        task.finally(() => this.inFlight.delete(task));
        return;
      }
      case "section.cancelled": {
        this.writeProtocol({
          type: "section.cancelled",
          section_id: action.sectionId,
          reason: action.reason,
        });
        if (this.verbose) {
          this.diagnosticWriter(
            `[untype] protocol section cancelled: ${action.sectionId} (${action.reason})`,
            false,
          );
        }
        return;
      }
      case "protocol.warning": {
        this.warn(action.message);
        return;
      }
      case "section.empty": {
        if (this.verbose) {
          this.diagnosticWriter("[untype] protocol: empty section ignored", false);
        }
        return;
      }
    }
  }

  private async processSection(
    action: Extract<ProtocolAction, { type: "section.submitted" }>,
  ): Promise<void> {
    let current = action.rawText;
    let refinedText: string | undefined;
    let sourceLanguage: "el" | "en" | undefined;
    let targetLanguage: "el" | "en" | undefined;
    const operators = action.operators;

    if (operators.includes("refine")) {
      if (this.refiner === null) {
        this.warn("Refine operator is enabled, but no LLM refiner is configured.");
      } else {
        try {
          const refined = await this.refiner.refine(current);
          if (refined.length > 0) {
            refinedText = refined;
            current = refined;
          }
        } catch (err) {
          this.logOperatorFailure("refine", err);
        }
      }
    }

    if (operators.includes("translate")) {
      if (this.translator === null) {
        this.warn("Translate operator is enabled, but no LLM translator is configured.");
      } else {
        sourceLanguage = detectLanguage(current);
        targetLanguage = targetLanguageFor(sourceLanguage, this.translationPolicy);
        try {
          const translated = await this.translator.refine(
            `Translate the following text to ${targetLanguage === "en" ? "English" : "Greek"}. Return only the translated text.\n\n${current}`,
          );
          if (translated.length > 0) {
            current = translated;
          }
        } catch (err) {
          this.logOperatorFailure("translate", err);
        }
      }
    }

    this.writeProtocol({
      type: "section.processed",
      section_id: action.sectionId,
      operators,
      raw_text: action.rawText,
      refined_text: refinedText,
      source_language: sourceLanguage,
      target_language: targetLanguage,
      output_text: current,
    });

    if (this.mode !== "agent-protocol" && current.length > 0) {
      this.renderer.refined(current);
    }

    if (operators.includes("clipboard")) {
      try {
        await this.clipboardWriter(current);
        this.writeProtocol({
          type: "clipboard.copied",
          section_id: action.sectionId,
        });
      } catch (err) {
        this.logOperatorFailure("clipboard", err);
      }
    }

    if (operators.includes("input")) {
      try {
        await this.inputWriter(current);
        this.writeProtocol({
          type: "input.sent",
          section_id: action.sectionId,
        });
      } catch (err) {
        this.warnOperatorFailure(
          "input",
          err,
          inputFailureRemediation(err),
        );
      }
    }
  }

  private writeProtocol(event: ProtocolEvent): void {
    this.writer?.write(event);
  }

  private warn(message: string): void {
    this.diagnosticWriter(`[untype] protocol warning: ${message}`, true);
    this.writeProtocol({
      type: "protocol.warning",
      message,
    });
  }

  private logOperatorFailure(operator: OperatorKey, err: unknown): void {
    if (!this.verbose) return;
    const tag =
      err instanceof LLMRefinementError ? `llm-${err.kind}` : operator;
    const message = err instanceof Error ? err.message : String(err);
    this.diagnosticWriter(
      `[untype] protocol ${operator} failed (${tag}): ${message}`,
      true,
    );
  }

  private warnOperatorFailure(
    operator: OperatorKey,
    err: unknown,
    remediation: string,
  ): void {
    const message = err instanceof Error ? err.message : String(err);
    const warning = `${operator} operator failed: ${message}. ${remediation}`;
    this.warn(warning);
    if (this.verbose && err instanceof Error && err.stack !== undefined) {
      this.diagnosticWriter(err.stack, true);
    }
  }
}

function inputFailureRemediation(err: unknown): string {
  if (err instanceof FocusedInputDeliveryError) {
    if (err.code === "accessibility_not_trusted") {
      return [
        "Open System Settings > Privacy & Security > Accessibility and enable untype-input-helper, plus the app that launched untype if macOS lists it separately.",
        "Restart the launching app after changing the permission, then focus the target input control before command send completes.",
      ].join(" ");
    }
    if (err.code === "helper_unavailable") {
      return "Rebuild untype so dist/native/macos/untype-input-helper exists and is executable.";
    }
    if (err.code === "unsupported_platform") {
      return "Focused input delivery is currently macOS-only.";
    }
  }
  const message = err instanceof Error ? err.message : String(err);
  if (
    message.includes("not allowed to send keystrokes") ||
    message.includes("(1002)")
  ) {
    return [
      "macOS blocked System Events keystrokes.",
      "Open System Settings > Privacy & Security > Accessibility and enable the app that launched untype, such as Terminal, iTerm2, VS Code, or Cursor.",
      "Restart that app after changing the permission, then focus the target input control before command send completes.",
    ].join(" ");
  }
  return "Check that the target control is focused before command send completes, and grant Accessibility permission to the terminal app running untype.";
}

function formatStatusReport(report: {
  operators: OperatorState;
  translation_policy: TranslationPolicy;
  pending_section: boolean;
}): string {
  return `[untype] status: ${formatStatusSummary(report)}`;
}

function formatStatusSummary(report: {
  operators: OperatorState;
  translation_policy: TranslationPolicy;
  pending_section: boolean;
}): string {
  const { operators } = report;
  return [
    `refine=${operators.refine ? "on" : "off"}`,
    `translate=${operators.translate ? "on" : "off"}`,
    `clipboard=${operators.clipboard ? "on" : "off"}`,
    `input=${operators.input ? "on" : "off"}`,
    `translation_policy=${report.translation_policy}`,
    `pending_section=${report.pending_section ? "yes" : "no"}`,
  ].join(", ");
}

export function detectLanguage(text: string): "el" | "en" {
  return /\p{Script=Greek}/u.test(text) ? "el" : "en";
}

export function targetLanguageFor(
  source: "el" | "en",
  policy: TranslationPolicy,
): "el" | "en" {
  if (policy === "to-en") return "en";
  if (policy === "to-el") return "el";
  return source === "el" ? "en" : "el";
}

async function copyToClipboard(text: string): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("clipboard copy is only implemented with pbcopy on macOS");
  }
  await runCommand("pbcopy", [], text);
}

async function runCommand(
  command: string,
  args: string[],
  stdinText?: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code}: ${stderr.trim()}`));
    });
    child.stdin.end(stdinText ?? "");
  });
}
