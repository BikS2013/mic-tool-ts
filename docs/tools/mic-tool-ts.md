# mic-tool-ts

## Summary

`mic-tool-ts` is the project CLI tool. It captures macOS microphone audio, streams PCM audio to a realtime speech-to-text provider (Soniox by default, ElevenLabs when selected), detects spoken section markers, optionally processes submitted sections through an LLM, and writes human transcripts or JSONL voice-agent protocol events.

The human transcript renderer suppresses identical consecutive partial snapshots before writing stdout. This prevents repeated interim STT hypotheses from appearing as duplicate transcript lines while preserving finalized utterances.

For Soniox, the adapter also overlap-merges repeated finalized prefixes before they reach the renderer, because live result frames can repeat already-final text while a non-final suffix is still evolving.

## Invocation

The supported user-facing invocation is the direct OS command:

```
mic-tool-ts
```

The macOS monitoring UI is launched with:

```
mic-tool-ts ui
```

Do not document `node dist/index.js`, `tsx src/index.ts`, `pnpm run dev`, or package-manager scripts as the installed-tool invocation. Those commands are development conveniences only.

For local development installs, prefer a symlink from a PATH directory:

```
ln -sf "$(pwd)/dist/index.js" ~/.local/bin/mic-tool-ts
```

`pnpm link` is not required.

## Configuration

- Per-user configuration folder: `~/.tool-agents/mic-tool-ts/`.
- Per-user secrets file: `~/.tool-agents/mic-tool-ts/.env`.
- Project-specific env-var prefix: `MIC_TOOL_TS_*`.
- Provider-canonical env vars keep their canonical names, such as `SONIOX_API_KEY` and `AZURE_OPENAI_*`.

Full configuration reference: `docs/design/configuration-guide.md`.

## Voice Agent Protocol

- Default markers: `command refine|translate|clipboard|input`, `command status`, `command send`, `command cancel`, and `literal phrase`.
- Supported operators: `refine`, `translate`, `clipboard`, and `input`.
- `--interaction-mode agent-protocol` emits one JSON object per line on stdout for downstream agents.
- `--interaction-mode hybrid --protocol-output <path>` keeps human text on stdout and writes JSONL events to the selected file.
- `command input` sends the final processed section output to the currently focused macOS input control using clipboard + paste; Accessibility permission may be required, and failures emit a non-fatal warning.
- Runtime protocol settings are remembered in `~/.tool-agents/mic-tool-ts/state.json`: `refine`, `translate`, `clipboard`, `input`, and `translation_policy`. Explicit CLI/env defaults override saved state.

## User Documentation

- `README.md`
- `docs/design/configuration-guide.md`
- `docs/design/project-functions.md`
- `docs/design/project-design.md`

## Electron UI

- `mic-tool-ts ui` opens the Electron UI.
- The Electron main process runs the shared session runner and owns configuration resolution, mic/STT lifecycle, protocol persistence, clipboard/input operations, and IPC.
- Human transcript text and status messages render in the UI through typed session events, not by parsing terminal output.
- On load, the UI resolves the same config chain as the CLI and displays non-secret runtime state: active provider, model, language hints, sample rate, protocol mode, operator state, API-key configured/missing status, expiry, and source tier.
- The settings/protocol panes contain editable controls for STT provider, model, language hints, sample rate, endpoint detection, protocol mode, operator defaults, translation policy, and LLM enablement. UI edits are sent through the preload bridge, refresh provider credential status, and apply as explicit CLI-equivalent settings on the next started session.
- Renderer content is local packaged content under `dist/ui/renderer/`, with no Node integration, context isolation, sandboxing, and a narrow preload API.
