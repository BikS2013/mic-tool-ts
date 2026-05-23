# untype

<untype>
  <objective>
    `untype` is the project CLI tool. It captures macOS microphone audio, streams PCM audio to a realtime speech-to-text provider (Soniox by default, ElevenLabs when selected), detects spoken section markers, optionally processes submitted sections through an LLM, and writes human transcripts or JSONL voice-agent protocol events. The human transcript renderer suppresses identical consecutive partial snapshots before writing stdout. For Soniox, the adapter also overlap-merges repeated finalized prefixes before they reach the renderer, because live result frames can repeat already-final text while a non-final suffix is still evolving.
  </objective>

  <command>
    untype
    untype ui
  </command>

  <info>
## Summary

`untype` is the project CLI tool. It captures macOS microphone audio, streams PCM audio to a realtime speech-to-text provider (Soniox by default, ElevenLabs when selected), detects spoken section markers, optionally processes submitted sections through an LLM, and writes human transcripts or JSONL voice-agent protocol events.

The human transcript renderer suppresses identical consecutive partial snapshots before writing stdout. This prevents repeated interim STT hypotheses from appearing as duplicate transcript lines while preserving finalized utterances.

For Soniox, the adapter also overlap-merges repeated finalized prefixes before they reach the renderer, because live result frames can repeat already-final text while a non-final suffix is still evolving.

## Invocation

The supported user-facing invocation is the direct OS command:

```
untype
```

The macOS monitoring UI is launched with:

```
untype ui
```

Do not document `node dist/index.js`, `tsx src/index.ts`, `pnpm run dev`, or package-manager scripts as the installed-tool invocation. Those commands are development conveniences only.

For local development installs, prefer a symlink from a PATH directory:

```
ln -sf "$(pwd)/dist/index.js" ~/.local/bin/untype
```

`pnpm link` is not required.

## Configuration

- Per-user configuration folder: `~/.tool-agents/untype/`.
- Per-user secrets file: `~/.tool-agents/untype/.env`.
- Project-specific env-var prefix: `UNTYPE_*`.
- Provider-canonical env vars keep their canonical names, such as `SONIOX_API_KEY` and `AZURE_OPENAI_*`.

Full configuration reference: `docs/design/configuration-guide.md`.

## Voice Agent Protocol

- Default markers: `command refine|translate|clipboard|input`, `command status`, `command send`, `command cancel`, and `literal phrase`.
- Supported operators: `refine`, `translate`, `clipboard`, and `input`.
- `--interaction-mode agent-protocol` emits one JSON object per line on stdout for downstream agents.
- `--interaction-mode hybrid --protocol-output <path>` keeps human text on stdout and writes JSONL events to the selected file.
- `command input` sends the final processed section output to the currently focused macOS input control using the bundled native helper. The helper reads text from stdin, tries direct Accessibility insertion, Unicode keyboard events, then clipboard-preserving key-code paste; Accessibility permission may be required, and failures emit a non-fatal warning.
- Runtime protocol settings are remembered in `~/.tool-agents/untype/state.json`: `refine`, `translate`, `clipboard`, `input`, and `translation_policy`. Explicit CLI/env defaults override saved state.

## User Documentation

- `README.md`
- `docs/design/configuration-guide.md`
- `docs/design/project-functions.md`
- `docs/design/project-design.md`

## Electron UI

- `untype ui` opens the Electron UI.
- The Electron main process runs the shared session runner and owns configuration resolution, mic/STT lifecycle, protocol persistence, clipboard/input operations, and IPC.
- Human transcript text and status messages render in the UI through typed session events, not by parsing terminal output.
- On load, the UI resolves the same config chain as the CLI and displays non-secret runtime state: active provider, model, language hints, sample rate, protocol mode, operator state, API-key configured/missing status, expiry, and source tier.
- The settings/protocol panes contain editable controls for STT provider, model, language hints, sample rate, endpoint detection, push-to-talk hotkey, protocol mode, operator defaults, translation policy, LLM enablement, LLM provider, and LLM model/deployment. The right sidepanel duplicates only the four protocol operator switches: refine, translate, clipboard, and focused input. UI edits are sent through the preload bridge, persisted in `~/.tool-agents/untype/ui-state.json`, refresh provider credential status, and apply as explicit CLI-equivalent settings on the next started session where applicable. API-key values and derived credential status are not persisted in UI state.
- Push-to-talk is system-wide in UI mode: when enabled and `untype ui` is running, pressing the configured hotkey starts capture even if another app is focused, and releasing it stops capture and submits the pending section to the existing processing pipeline. The default is `Control+\``. Electron reserves the shortcut with macOS for the press path so foreground apps should not receive it. A native hook handles key release; macOS may require Accessibility or Input Monitoring permission for the app that launched the UI. If the release hook cannot start, the UI warns and the registered hotkey falls back to press-to-toggle.
- Active push-to-talk recording shows an independent bottom-center Electron overlay with live partial text, short final/warning/error states, and compact indicators for refine, translate, clipboard, and input protocol state. The overlay is display-only, does not steal focus, does not show for manual listening sessions, and clears transcript text when hidden; transcript text and secret values are never persisted.
- While the dictation hotkey is held, secondary keys toggle active protocol operators for the pending section: `R` for refine, `T` for translate, `C` for clipboard, and `I` for focused input. These toggles emit the same `state.changed` protocol events as spoken protocol commands.
- The protocol operator switches remain editable during warmed, recording, and manual listening states. Other session-shaping settings remain disabled until the session stops.
- Renderer content is local packaged content under `dist/ui/renderer/`, with no Node integration, context isolation, sandboxing, and a narrow preload API.
  </info>
</untype>
