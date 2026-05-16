# mic-tool-ts

A TypeScript CLI that captures live microphone audio on macOS, streams it to a realtime speech-to-text provider (Soniox by default, ElevenLabs as an alternative), detects spoken section markers, optionally processes submitted sections through an LLM (Azure OpenAI in v1), and can emit either human transcript text or JSONL voice-agent protocol events.

Status: v0.1.0 — macOS only, Azure OpenAI for refinement.

---

## Prerequisites

- macOS (the v1 mic source spawns `sox` against CoreAudio).
- Node.js >= 20.12.
- `sox` on the `$PATH`. Install with:
  ```
  brew install sox
  ```
- A Soniox account and API key (<https://console.soniox.com>) for the default provider, or an ElevenLabs API key for `--stt-provider elevenlabs`.
- For LLM refinement (default): an Azure OpenAI resource with a chat-completion deployment.
- macOS microphone permission granted to your terminal (System Settings → Privacy & Security → Microphone). The first run will trigger the OS prompt.

---

## Install

```
git clone <repo-url> mic-tool-ts
cd mic-tool-ts
pnpm install
pnpm build
chmod +x dist/index.js
mkdir -p ~/.local/bin
ln -sf "$(pwd)/dist/index.js" ~/.local/bin/mic-tool-ts   # adjust to a directory on your PATH
```

Verify:

```
mic-tool-ts --version
mic-tool-ts --help
```

The supported user invocation is the direct OS command `mic-tool-ts` on your `PATH`. `pnpm`, `tsx`, and `node dist/index.js` are development/build conveniences, not the documented way to run the installed tool.

If `mic-tool-ts` is not found after building, verify that `~/.local/bin` is on your `PATH` and that `~/.local/bin/mic-tool-ts` points to this project's `dist/index.js`. `pnpm link` is not required for local use.

---

## Configuration

Full reference: [`docs/design/configuration-guide.md`](docs/design/configuration-guide.md).

`mic-tool-ts` resolves each value from this priority chain (highest first):

1. CLI flag
2. `<cwd>/.env`
3. `~/.tool-agents/mic-tool-ts/.env`  (recommended for secrets; folder mode `0700`, file mode `0600`)
4. shell environment

Minimal secret-store setup (one-time):

```
mkdir -m 0700 -p ~/.tool-agents/mic-tool-ts
cat > ~/.tool-agents/mic-tool-ts/.env <<'EOF'
# --- Soniox ---
SONIOX_API_KEY=sk_your_real_key_here
SONIOX_API_KEY_EXPIRES_AT=2026-11-15   # optional renewal reminder

# --- ElevenLabs (only needed with --stt-provider elevenlabs) ---
ELEVENLABS_API_KEY=xi_your_real_key_here
ELEVENLABS_API_KEY_EXPIRES_AT=2026-11-15   # optional renewal reminder

# --- Azure OpenAI (only needed when --refine is on, which is the default) ---
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=gpt-5.4
AZURE_OPENAI_API_VERSION=2024-10-21
EOF
chmod 0600 ~/.tool-agents/mic-tool-ts/.env
```

For non-secret project overrides (e.g. a per-project language pair) use a project-local `<cwd>/.env`.

---

## Usage

```
# Basic — uses every default, reads SONIOX_API_KEY from the secret store
mic-tool-ts

# Diagnostic logging on stderr (transcripts still on stdout)
mic-tool-ts --verbose

# Custom guard phrase
mic-tool-ts --guard-phrase "stop please"

# Disable LLM refinement (transcripts only, no cleanup pass)
mic-tool-ts --no-refine

# Force append-mode rendering (one line per partial + final)
mic-tool-ts --output-mode append

# Redirect to a file — auto-downgrades overwrite → append to avoid \r artefacts
mic-tool-ts > session.log

# Override language hints (repeat the flag or use the CSV env var)
mic-tool-ts --language pt-BR --language en

# Let Soniox auto-detect the language
mic-tool-ts --language auto

# Custom Soniox model + sample rate
mic-tool-ts --model stt-rt-v4 --sample-rate 24000

# Use ElevenLabs Scribe Realtime instead of Soniox
mic-tool-ts --stt-provider elevenlabs --elevenlabs-api-key xi_...

# Emit JSONL events for downstream agents instead of human transcript text
mic-tool-ts --interaction-mode agent-protocol --no-refine
```

While running, the tool emits:

- A startup readiness line on stderr: `[mic-tool-ts] Ready to listen. Press Control-C to stop the listening tool.`
- Verbatim partial / final tokens (according to `--output-mode`), with repeated Soniox finalized prefixes and identical consecutive partial snapshots suppressed.
- On `command send` or the configured section-end phrase: a blank line in dictation mode.
- On `command status`: a status line in dictation mode, or a `status.reported` JSONL event in agent-protocol mode.
- If active operators process the section: the processed text on its own line + another blank line in dictation mode, or a `section.processed` JSONL event in agent-protocol mode.

Press Ctrl+C to stop. A second Ctrl+C during shutdown force-quits (exit code 130).

---

## Oral agent commands

`mic-tool-ts` recognizes protocol markers only from finalized STT text, never partials.

Default spoken markers:

- `command refine`, `command translate`, or `command clipboard` enables a persistent operator. Add `off` to disable it, for example `command refine off`.
- `command status` reports the current operator state, translation policy, and whether an unsent section is pending.
- `command send` submits the current section for processing.
- `command cancel` discards the current section.
- `literal phrase` treats the next recognized marker as dictated text.

Example:

```
command refine.
command translate.
Open docs design project design and find the LLM refinement section.
command status.
command send.
```

In `agent-protocol` mode, stdout contains JSON Lines such as `state.changed`, `status.reported`, `section.submitted`, `section.processed`, `section.cancelled`, `clipboard.copied`, and `session.ended`. Human diagnostics, including the ready message, stay on stderr.

---

## Common errors and remediation

| Error message (stderr)                                                              | Exit | Likely cause / fix                                                                                       |
|-------------------------------------------------------------------------------------|-----:|----------------------------------------------------------------------------------------------------------|
| `missing_configuration: SONIOX_API_KEY is not set. Provide via --api-key ...`       |    2 | Set the key in one of the four config tiers. See [Configuration](#configuration).                        |
| `missing_configuration: ELEVENLABS_API_KEY is not set. Provide via --elevenlabs-api-key ...` | 2 | Set the ElevenLabs key or choose the default Soniox provider.                                             |
| `invalid_configuration: --sample-rate / MIC_TOOL_TS_SAMPLE_RATE must be >= 8000.`      |    2 | Pick a sample rate in `[8000, 48000]`.                                                                   |
| `invalid_configuration: --endpoint / MIC_TOOL_TS_ENDPOINT must be a wss:// or ws:// URL.` | 2 | The endpoint must start with `wss://` or `ws://`.                                                        |
| `llm_configuration: Azure OpenAI is enabled ... AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT` | 2 | Set the Azure env vars OR pass `--no-refine`.                                                            |
| `mic_unavailable: sox not installed. Install with: brew install sox`                |    3 | Run `brew install sox` and re-launch.                                                                    |
| `mic_permission_denied: ...`                                                        |    3 | Grant microphone permission to the terminal: System Settings → Privacy & Security → Microphone.          |
| `soniox_auth: ...`                                                                  |    4 | Soniox rejected the key — rotate it from the Soniox console and update your `.env`.                      |
| `soniox_network: ...`                                                               |    5 | Network issue / Soniox unreachable. Re-try; check `--endpoint`.                                          |
| `soniox_protocol: ...`                                                              |    6 | Soniox rejected the session config (bad request, quota). See the message for details.                    |
| `elevenlabs_auth: ...`                                                              |    4 | ElevenLabs rejected the key or account access. Rotate/check the key and Scribe access.                   |
| `elevenlabs_network: ...`                                                           |    5 | Network issue / ElevenLabs unreachable. Re-try; check `--endpoint`.                                      |
| `elevenlabs_protocol: ...`                                                          |    6 | ElevenLabs rejected the session config, quota, rate limit, or input shape.                               |
| `[mic-tool-ts] WARNING: SONIOX_API_KEY expired N days ago ...`                         |  n/a | Renew the key at <https://console.soniox.com>; update `SONIOX_API_KEY_EXPIRES_AT`.                       |

`--verbose` is the fastest path to a more detailed diagnostic for any of the above.

---

## Documentation

- [`docs/design/project-design.md`](docs/design/project-design.md) — full technical design (units A–E + plans 002/003/004 additions).
- [`docs/design/project-functions.md`](docs/design/project-functions.md) — functional and non-functional requirements.
- [`docs/design/configuration-guide.md`](docs/design/configuration-guide.md) — every configuration knob, in detail.
- [`docs/tools/mic-tool-ts.md`](docs/tools/mic-tool-ts.md) — concise tool reference for agents.
- [`docs/design/plan-001-soniox-mic-cli.md`](docs/design/plan-001-soniox-mic-cli.md) — initial implementation plan.
- [`docs/design/plan-002-turn-detection.md`](docs/design/plan-002-turn-detection.md) — guard-phrase turn detection.
- [`docs/design/plan-003-llm-refinement.md`](docs/design/plan-003-llm-refinement.md) — LLM refinement.
- [`docs/design/plan-004-env-var-fallbacks-and-docs.md`](docs/design/plan-004-env-var-fallbacks-and-docs.md) — full env-var chain + key expiry.
- [`docs/design/plan-005-project-rename-mic-tool-ts.md`](docs/design/plan-005-project-rename-mic-tool-ts.md) — project, command, and config-folder rename.
- [`docs/design/plan-006-elevenlabs-transcription-provider.md`](docs/design/plan-006-elevenlabs-transcription-provider.md) — ElevenLabs STT provider.

---

## License

MIT.
