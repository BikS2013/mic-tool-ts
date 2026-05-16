# mic-tool

A TypeScript CLI that captures live microphone audio on macOS, streams it to the Soniox real-time speech-to-text API via the `@soniox/node` v2 SDK, detects turn boundaries on a configurable Greek/English guard phrase, optionally polishes each closed turn through an LLM (Azure OpenAI in v1), and renders both the verbatim and the cleaned text to standard output.

Status: v0.1.0 — macOS only, Azure OpenAI for refinement.

---

## Prerequisites

- macOS (the v1 mic source spawns `sox` against CoreAudio).
- Node.js >= 20.12 (required for native `process.loadEnvFile` and built-in `fetch`).
- `sox` on the `$PATH`. Install with:
  ```
  brew install sox
  ```
- A Soniox account and API key (<https://console.soniox.com>).
- For LLM refinement (default): an Azure OpenAI resource with a chat-completion deployment.
- macOS microphone permission granted to your terminal (System Settings → Privacy & Security → Microphone). The first run will trigger the OS prompt.

---

## Install

```
git clone <repo-url> mic-tool
cd mic-tool
pnpm install
pnpm build
ln -s "$(pwd)/dist/index.js" ~/.local/bin/mic-tool   # adjust to a directory on your PATH
chmod +x dist/index.js
```

Verify:

```
mic-tool --version
mic-tool --help
```

---

## Configuration

Full reference: [`docs/design/configuration-guide.md`](docs/design/configuration-guide.md).

`mic-tool` resolves each value from this priority chain (highest first):

1. CLI flag
2. `<cwd>/.env`
3. `~/.tool-agents/mic-tool/.env`  (recommended for secrets; folder mode `0700`, file mode `0600`)
4. shell environment

Minimal secret-store setup (one-time):

```
mkdir -m 0700 -p ~/.tool-agents/mic-tool
cat > ~/.tool-agents/mic-tool/.env <<'EOF'
# --- Soniox ---
SONIOX_API_KEY=sk_your_real_key_here
SONIOX_API_KEY_EXPIRES_AT=2026-11-15   # optional renewal reminder

# --- Azure OpenAI (only needed when --refine is on, which is the default) ---
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=gpt-5.4
AZURE_OPENAI_API_VERSION=2024-10-21
EOF
chmod 0600 ~/.tool-agents/mic-tool/.env
```

For non-secret project overrides (e.g. a per-project language pair) use a project-local `<cwd>/.env`.

---

## Usage

```
# Basic — uses every default, reads SONIOX_API_KEY from the secret store
mic-tool

# Diagnostic logging on stderr (transcripts still on stdout)
mic-tool --verbose

# Custom guard phrase
mic-tool --guard-phrase "stop please"

# Disable LLM refinement (transcripts only, no cleanup pass)
mic-tool --no-refine

# Force append-mode rendering (one line per partial + final)
mic-tool --output-mode append

# Redirect to a file — auto-downgrades overwrite → append to avoid \r artefacts
mic-tool > session.log

# Override language hints (repeat the flag or use the CSV env var)
mic-tool --language pt-BR --language en

# Let Soniox auto-detect the language
mic-tool --language auto

# Custom Soniox model + sample rate
mic-tool --model stt-rt-v4 --sample-rate 24000
```

While running, the tool emits:

- Verbatim partial / final tokens (according to `--output-mode`).
- On the guard phrase: a blank line.
- If refinement is enabled and succeeds: the cleaned text on its own line + another blank line.

Press Ctrl+C to stop. A second Ctrl+C during shutdown force-quits (exit code 130).

---

## Common errors and remediation

| Error message (stderr)                                                              | Exit | Likely cause / fix                                                                                       |
|-------------------------------------------------------------------------------------|-----:|----------------------------------------------------------------------------------------------------------|
| `missing_configuration: SONIOX_API_KEY is not set. Provide via --api-key ...`       |    2 | Set the key in one of the four config tiers. See [Configuration](#configuration).                        |
| `invalid_configuration: --sample-rate / MIC_TOOL_SAMPLE_RATE must be >= 8000.`      |    2 | Pick a sample rate in `[8000, 48000]`.                                                                   |
| `invalid_configuration: --endpoint / MIC_TOOL_ENDPOINT must be a wss:// or ws:// URL.` | 2 | The endpoint must start with `wss://` or `ws://`.                                                        |
| `llm_configuration: Azure OpenAI is enabled ... AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT` | 2 | Set the Azure env vars OR pass `--no-refine`.                                                            |
| `mic_unavailable: sox not installed. Install with: brew install sox`                |    3 | Run `brew install sox` and re-launch.                                                                    |
| `mic_permission_denied: ...`                                                        |    3 | Grant microphone permission to the terminal: System Settings → Privacy & Security → Microphone.          |
| `soniox_auth: ...`                                                                  |    4 | Soniox rejected the key — rotate it from the Soniox console and update your `.env`.                      |
| `soniox_network: ...`                                                               |    5 | Network issue / Soniox unreachable. Re-try; check `--endpoint`.                                          |
| `soniox_protocol: ...`                                                              |    6 | Soniox rejected the session config (bad request, quota). See the message for details.                    |
| `[mic-tool] WARNING: SONIOX_API_KEY expired N days ago ...`                         |  n/a | Renew the key at <https://console.soniox.com>; update `SONIOX_API_KEY_EXPIRES_AT`.                       |

`--verbose` is the fastest path to a more detailed diagnostic for any of the above.

---

## Documentation

- [`docs/design/project-design.md`](docs/design/project-design.md) — full technical design (units A–E + plans 002/003/004 additions).
- [`docs/design/project-functions.md`](docs/design/project-functions.md) — functional and non-functional requirements.
- [`docs/design/configuration-guide.md`](docs/design/configuration-guide.md) — every configuration knob, in detail.
- [`docs/design/plan-001-soniox-mic-cli.md`](docs/design/plan-001-soniox-mic-cli.md) — initial implementation plan.
- [`docs/design/plan-002-turn-detection.md`](docs/design/plan-002-turn-detection.md) — guard-phrase turn detection.
- [`docs/design/plan-003-llm-refinement.md`](docs/design/plan-003-llm-refinement.md) — LLM refinement.
- [`docs/design/plan-004-env-var-fallbacks-and-docs.md`](docs/design/plan-004-env-var-fallbacks-and-docs.md) — full env-var chain + key expiry.

---

## License

MIT.
