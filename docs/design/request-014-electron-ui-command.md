# Refined Request: Electron UI Command

## Category

Design, documentation, and technical investigation.

## Objective

Define an implementation approach for adding a `ui` subcommand to the installed `mic-tool-ts` command. The proposed UI must be Electron-based, let the user configure existing tool settings, and monitor an ongoing transcription session. When the UI is active, human transcript rendering must happen in the UI rather than in the console.

## Scope

In scope:

- Document the proposed architecture for `mic-tool-ts ui`.
- Describe how the UI should connect to the existing transcription, protocol, renderer, and configuration layers.
- Describe the macOS Tahoe 26 visual target and the Electron APIs that can approximate it.
- Create a standalone HTML visual mockup file.
- Keep the current CLI behavior unchanged in the design.

Out of scope:

- No production Electron implementation.
- No dependency changes to `package.json`.
- No package installation, build tooling changes, or Electron packaging setup.
- No change to the current installed invocation contract beyond the proposed `mic-tool-ts ui` subcommand.

## Requirements

- The proposed end-user invocation must be `mic-tool-ts ui`.
- The UI must expose the existing STT, language, output, protocol, LLM, and diagnostic settings in a macOS-style settings surface.
- The UI must show live partial transcript text, finalized transcript text, session state, provider state, audio/microphone state, and protocol/operator state.
- When `mic-tool-ts ui` is active, human-facing transcript text and status messages must be rendered in the UI instead of `stdout`.
- Console output during UI mode must be limited to fatal bootstrap failures before the UI window can receive events.
- Required configuration values must still fail closed with typed errors. The UI must not invent fallback values.
- Secret values must continue to use the project configuration convention: `~/.tool-agents/mic-tool-ts/.env` with file mode `0600` inside a `0700` folder.
- The UI must use local packaged renderer content only, with a restricted preload bridge and no Node.js access in the web renderer.
- The UI visual language must target the current host platform reported by `sw_vers`: macOS 26.4.1, build 25E253.
- The HTML visual mockup must be a standalone `.html` file, not an image embedded inside Markdown.

## Constraints

- The project is TypeScript.
- The existing direct OS command `mic-tool-ts` remains the supported user-facing invocation.
- No hidden defaults are allowed for missing required configuration.
- Electron must be dependency-vetted before it is added in a later implementation pass.
- Electron can approximate macOS Tahoe Liquid Glass through native vibrancy and CSS, but it cannot provide exact SwiftUI/AppKit Liquid Glass parity inside web content.

## Acceptance Criteria

- A plan document exists under `docs/design` using the required `plan-xxx-<description>.md` naming pattern.
- A research document exists under `docs/reference` using the required `investigation-xxx-<description>.md` naming pattern and includes source URLs, access date, findings, and derived decisions.
- A standalone HTML visual exists under `docs/design` and can be opened directly in a browser.
- The plan clearly specifies that UI mode must use a UI renderer/event sink instead of `StdoutRenderer` for human-facing transcript output.
- The plan identifies the implementation modules, IPC boundaries, lifecycle, security model, dependency-vetting step, and verification strategy.

## Assumptions

- The first implementation should be macOS-first because the current microphone backend is macOS-only.
- The UI opens in an idle/configurable state; the user starts and stops listening from the UI.
- Existing CLI flags and environment variables remain authoritative; UI settings are an explicit runtime configuration source equivalent to CLI-provided values.
- A future implementation may choose whether to persist non-secret UI preferences separately from the existing protocol state.

## Open Questions

- Should `mic-tool-ts ui` auto-start listening when all required configuration is present, or should it always wait for the user to press Start?
- Should the UI persist all editable non-secret settings by default, or only save when the user explicitly presses Save?
- Should UI mode expose protocol JSONL export controls, or keep machine protocol output as a CLI-only feature in the first release?

## Original Request

> I want you to consider adding the command `ui` to the tool, which will create an Electron-based UI. 
> The UI will allow the user to configure the settings and parameters and at the same time monitor the progress of the ongoing conversation (transcribe).
>
> When the tool’s UI is active, text rendering should happen there and not in the console.
>
> It is also important that the look and feel of the tool’s UI be very close to the look and feel of macOS, specifically the version we are currently on. It should have all those transparencies and animations supported by the design system proposed by the current version of macOS.
>
> I don’t want you to write code for me. I just want you to prepare and describe in a document the implementation approach and, possibly, also prepare some kind of visual that shows roughly what we expect it to look like. The visual must be in HTML; I don’t want it to be an embedded visual inside a markdown file.
