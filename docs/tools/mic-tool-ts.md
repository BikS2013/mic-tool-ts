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

- Default markers: `command refine|translate|clipboard`, `command status`, `command send`, `command cancel`, and `literal phrase`.
- Supported operators: `refine`, `translate`, and `clipboard`.
- `--interaction-mode agent-protocol` emits one JSON object per line on stdout for downstream agents.
- `--interaction-mode hybrid --protocol-output <path>` keeps human text on stdout and writes JSONL events to the selected file.
- Runtime protocol settings are remembered in `~/.tool-agents/mic-tool-ts/state.json`: `refine`, `translate`, `clipboard`, and `translation_policy`. Explicit CLI/env defaults override saved state.

## User Documentation

- `README.md`
- `docs/design/configuration-guide.md`
- `docs/design/project-functions.md`
- `docs/design/project-design.md`
