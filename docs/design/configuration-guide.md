# mic-tool-ts — Configuration Guide

This document is the authoritative reference for every configuration parameter `mic-tool-ts` accepts: where each value can come from, how the resolver picks between sources, how to obtain each value, and where the user is recommended to store it. It satisfies the project-wide `<configuration-guide>` rule from `~/.claude/CLAUDE.md`.

See also:
- `docs/design/project-design.md` §14 — implementation specification of the four-tier chain.
- `docs/design/project-functions.md` FR-15..FR-17 / NFR-8..NFR-10 — formal requirements.
- `docs/design/plan-004-env-var-fallbacks-and-docs.md` — the plan that introduced the full schema.

---

## 1. Configuration sources and their priority

`mic-tool-ts` resolves every configurable value by walking four sources in this order — the first source that yields a non-whitespace value wins:

```
+----------------------+   highest priority
| 1. CLI flag          |   --api-key sk_...
+----------------------+
| 2. <cwd>/.env        |   project-local; checked into git? NEVER for secrets.
+----------------------+
| 3. ~/.tool-agents/   |   per-user, secrets-grade.
|    mic-tool-ts/.env     |   Folder mode 0700, file mode 0600.
+----------------------+
| 4. process.env       |   shell environment (export VAR=...)
+----------------------+   lowest priority
```

Notes:
- Whitespace-only values are treated as missing. A `.env` file containing `SONIOX_API_KEY=   ` does NOT satisfy the resolver — it will fall through to the next tier.
- `mic-tool-ts` never mutates `process.env`. The chain is read-only.
- The two `.env` files are optional. Missing files are not errors; malformed files (e.g. unterminated quote) raise `InvalidConfigurationError` so you are never silently deprived of a value you thought was loaded.
- Run with `--verbose` to see which source supplied the active STT provider API key. The value itself is never logged.
- Remembered runtime protocol settings are not part of this four-tier configuration chain. They are restored from `~/.tool-agents/mic-tool-ts/state.json` after config resolution, and only for protocol settings that still came from built-in defaults.

### Example resolution

You set:

```
# in ~/.tool-agents/mic-tool-ts/.env
SONIOX_API_KEY=sk_user_default
MIC_TOOL_TS_LANGUAGES=el,en

# in ./.env (project-local)
MIC_TOOL_TS_LANGUAGES=en

# in your shell
export SONIOX_API_KEY=sk_shell_value
```

And invoke:

```
mic-tool-ts --language pt
```

The resolver yields:

| Value          | Source picked                | Why                                                         |
|----------------|------------------------------|-------------------------------------------------------------|
| `apiKey`       | `~/.tool-agents/.../.env`    | No CLI flag, no local `.env` value; user-env tier wins over shell env. |
| `languages`    | CLI flag (`["pt"]`)          | Flag beats every env-var tier.                              |

---

## 2. Parameter reference

The table below is the complete contract. The "Default" column shows the value used when neither a flag nor any env-var tier supplies a value.

For `--refine-default`, `--translate-default`, `--clipboard-default`, and `--translation-policy`, the built-in default may be replaced by remembered runtime state from `~/.tool-agents/mic-tool-ts/state.json`. Explicit CLI or env values still take priority over remembered state.

| CLI flag                            | Env var                                | Default                                              | Required? |
|-------------------------------------|----------------------------------------|------------------------------------------------------|-----------|
| `--api-key <value>`                 | `SONIOX_API_KEY`                       | _none_                                               | **yes**   |
| `--api-key-expires-at <YYYY-MM-DD>` | `SONIOX_API_KEY_EXPIRES_AT`            | _unset_                                              | no        |
| `--stt-provider <name>`             | `MIC_TOOL_TS_STT_PROVIDER`                | `soniox`                                             | no        |
| `--elevenlabs-api-key <value>`      | `ELEVENLABS_API_KEY`                     | _none_                                               | yes, when `--stt-provider=elevenlabs` |
| `--elevenlabs-api-key-expires-at <YYYY-MM-DD>` | `ELEVENLABS_API_KEY_EXPIRES_AT` | _unset_                                              | no        |
| `--model <name>`                    | `MIC_TOOL_TS_MODEL`                       | provider-specific                                    | no        |
| `--endpoint <wss-url>`              | `MIC_TOOL_TS_ENDPOINT`                    | provider-specific                                    | no        |
| `--language <code>` (repeatable)    | `MIC_TOOL_TS_LANGUAGES` (CSV)             | provider-specific                                    | no        |
| `--sample-rate <hz>`                | `MIC_TOOL_TS_SAMPLE_RATE`                 | `16000`                                              | no        |
| `--no-endpoint-detection`           | `MIC_TOOL_TS_ENABLE_ENDPOINT_DETECTION`   | `true`                                               | no        |
| `--output-mode <mode>`              | `MIC_TOOL_TS_OUTPUT_MODE`                 | `overwrite`                                          | no        |
| `--guard-phrase <phrase>`           | `MIC_TOOL_TS_GUARD_PHRASE`                | `τέλος εντολής`                                      | no        |
| `--interaction-mode <mode>`         | `MIC_TOOL_TS_INTERACTION_MODE`            | `dictation`                                          | no        |
| `--command-phrase <phrase>`         | `MIC_TOOL_TS_COMMAND_PHRASE`              | `command`                                            | no        |
| `--section-end-phrase <phrase>`     | `MIC_TOOL_TS_SECTION_END_PHRASE`          | `command send`                                        | no        |
| `--section-cancel-phrase <phrase>`  | `MIC_TOOL_TS_SECTION_CANCEL_PHRASE`       | `command cancel`                                     | no        |
| `--literal-next-phrase <phrase>`    | `MIC_TOOL_TS_LITERAL_NEXT_PHRASE`         | `literal phrase`                                     | no        |
| `--refine-default <on|off>`         | `MIC_TOOL_TS_REFINE_DEFAULT`              | `off`                                                | no        |
| `--translate-default <on|off>`      | `MIC_TOOL_TS_TRANSLATE_DEFAULT`           | `off`                                                | no        |
| `--translation-policy <policy>`     | `MIC_TOOL_TS_TRANSLATION_POLICY`          | `opposite`                                           | no        |
| `--clipboard-default <on|off>`      | `MIC_TOOL_TS_CLIPBOARD_DEFAULT`           | `off`                                                | no        |
| `--protocol-output <path>`          | `MIC_TOOL_TS_PROTOCOL_OUTPUT`             | _unset_                                              | required when `--interaction-mode=hybrid` |
| `--refine` / `--no-refine`          | `MIC_TOOL_TS_REFINE`                      | `true`                                               | no        |
| `--llm-provider <name>`             | `MIC_TOOL_TS_LLM_PROVIDER`                | `azure-openai`                                       | no        |
| `--llm-model <name>`                | `MIC_TOOL_TS_LLM_MODEL`                   | `gpt-5.4`                                            | no        |
| `-v, --verbose`                     | `MIC_TOOL_TS_VERBOSE`                     | `false`                                              | no        |

Provider-specific env vars (consulted only when `--refine` is on AND `--llm-provider=azure-openai`):

| Env var                       | Required when refine is on? | Default                |
|-------------------------------|-----------------------------|------------------------|
| `AZURE_OPENAI_API_KEY`        | **yes**                     | —                      |
| `AZURE_OPENAI_ENDPOINT`       | **yes**                     | —                      |
| `AZURE_OPENAI_DEPLOYMENT`     | no                          | value of `--llm-model` |
| `AZURE_OPENAI_API_VERSION`    | no                          | `2024-10-21`           |

---

## 3. Per-parameter detail

### 3.1 `SONIOX_API_KEY` — Soniox API key (required)
- **Purpose**: authenticates the WebSocket session opened by the `@soniox/node` SDK.
- **Obtain**: create an account at <https://console.soniox.com>, navigate to the API Keys page, create a key.
- **Storage**: secrets-grade. Store in `~/.tool-agents/mic-tool-ts/.env` (folder 0700, file 0600). Never check into git. Never paste into a shared chat.
- **Options**: a non-empty string after trimming. No fallback — a missing key raises `MissingConfigurationError` with exit code 2.
- **Default**: none.

### 3.2 `SONIOX_API_KEY_EXPIRES_AT` — Soniox key renewal reminder (optional)
- **Purpose**: operational reminder. When set, the tool checks at startup and writes a single stderr warning if the key is within 14 days of expiry, or has already expired.
- **Obtain**: read it off the Soniox console, or set it to whatever date your team decided is a "renew by" date.
- **Storage**: anywhere — this is not a secret. Living alongside `SONIOX_API_KEY` in `~/.tool-agents/mic-tool-ts/.env` is the recommended pairing so the reminder cannot drift away from the key.
- **Options / format**: `YYYY-MM-DD`. The parser round-trips through `Date.UTC` so calendar-invalid values like `2026-02-30` are rejected.
- **Default**: unset → expiry tracking is disabled.
- **Behaviour**:
  - `> 14 days` away → silent (verbose only).
  - `1..14 days` away → `[mic-tool-ts] WARNING: SONIOX_API_KEY expires in N days (YYYY-MM-DD). Plan a renewal.`
  - Past expiry → `[mic-tool-ts] WARNING: SONIOX_API_KEY expired N days ago (YYYY-MM-DD). Renew at https://console.soniox.com.`
  - The tool always tries to run; expiry is operational, not enforcement.

### 3.3 `MIC_TOOL_TS_STT_PROVIDER` — realtime transcription provider
- **Purpose**: selects which provider receives microphone audio for transcription.
- **Storage**: project-local `.env`, shell, or CLI flag.
- **Options**: `soniox` or `elevenlabs`.
- **Default**: `soniox`.
- **Behavior**: provider selection controls which API key is required and which provider defaults apply for `MIC_TOOL_TS_MODEL`, `MIC_TOOL_TS_ENDPOINT`, and `MIC_TOOL_TS_LANGUAGES`.

### 3.4 `ELEVENLABS_API_KEY` — ElevenLabs API key (required for ElevenLabs)
- **Purpose**: authenticates the ElevenLabs Scribe Realtime WebSocket session.
- **Obtain**: create or copy an API key from the ElevenLabs dashboard.
- **Storage**: secrets-grade. Store in `~/.tool-agents/mic-tool-ts/.env` (folder 0700, file 0600). Never check into git.
- **Options**: a non-empty string after trimming. No fallback — when `--stt-provider=elevenlabs`, a missing key raises `MissingConfigurationError` with exit code 2.
- **Default**: none.

### 3.5 `ELEVENLABS_API_KEY_EXPIRES_AT` — ElevenLabs key renewal reminder (optional)
- **Purpose**: operational reminder. Mirrors `SONIOX_API_KEY_EXPIRES_AT` for the ElevenLabs key.
- **Storage**: recommended next to `ELEVENLABS_API_KEY` in `~/.tool-agents/mic-tool-ts/.env`.
- **Options / format**: `YYYY-MM-DD`.
- **Default**: unset → expiry tracking is disabled for ElevenLabs.

### 3.6 `MIC_TOOL_TS_MODEL` — STT provider realtime model
- **Purpose**: selects the active provider's realtime STT model.
- **Obtain**: see the active provider's model catalog. Soniox default is `stt-rt-v4`; ElevenLabs default is `scribe_v2_realtime`.
- **Storage**: project-local `.env` or shell — not a secret.
- **Options**: any string the selected provider accepts as a realtime transcription model.
- **Default**: `stt-rt-v4` for Soniox; `scribe_v2_realtime` for ElevenLabs.

### 3.7 `MIC_TOOL_TS_ENDPOINT` — STT provider WebSocket endpoint
- **Purpose**: lets you point the tool at a non-default provider endpoint.
- **Obtain**: from the active provider.
- **Storage**: project-local `.env` or shell.
- **Options**: must be a valid `wss://` (preferred) or `ws://` URL.
- **Default**: `wss://stt-rt.soniox.com/transcribe-websocket` for Soniox; `wss://api.elevenlabs.io/v1/speech-to-text/realtime` for ElevenLabs.

### 3.8 `MIC_TOOL_TS_LANGUAGES` — language hints
- **Purpose**: tells the active provider which language(s) to expect. Improves accuracy for code-switched dictation when the provider supports multiple hints.
- **Obtain**: ISO 639-1 (`en`) or 639-2 (`eng`) codes; regional variants supported as `pt-BR`.
- **Storage**: project-local `.env` if your project has a stable language pair; otherwise pass via CLI.
- **Options**:
  - A CSV string (env var): `el,en` → `["el", "en"]`.
  - A repeated flag (CLI): `--language el --language en`.
  - The single literal `auto` enables provider auto-detection. `auto` cannot be combined with any other code.
  - ElevenLabs accepts either `auto` or one explicit language code; multiple hints are rejected when `--stt-provider=elevenlabs`.
- **Default**: `el,en` for Soniox; `auto` for ElevenLabs.

### 3.9 `MIC_TOOL_TS_SAMPLE_RATE` — PCM sample rate (Hz)
- **Purpose**: drives BOTH the `sox` capture argv (`-r <value>`) AND the active provider session config. They MUST match — `mic-tool-ts` keeps them in lockstep from a single value.
- **Obtain**: just pick a supported rate; `16000` is the canonical rate for real-time STT.
- **Storage**: project-local `.env` or shell.
- **Options**: a positive integer in `[8000, 48000]`. For ElevenLabs, the value must be one of `8000`, `16000`, `22050`, `24000`, `44100`, or `48000`.
- **Default**: `16000`.

### 3.10 `MIC_TOOL_TS_ENABLE_ENDPOINT_DETECTION` — server-side endpoint / VAD detection
- **Purpose**: when `true`, Soniox uses server-side endpoint detection and ElevenLabs uses VAD commit strategy. When `false`, provider finality/commits are less automatic.
- **Obtain**: pick a boolean.
- **Storage**: project-local `.env` or shell.
- **Options**: `true` / `false` / `yes` / `no` / `on` / `off` / `1` / `0` (case-insensitive). The CLI side uses the flag `--no-endpoint-detection` to set it to `false`; there is no `--endpoint-detection` flag because the default is already on.
- **Default**: `true`.

### 3.11 `MIC_TOOL_TS_OUTPUT_MODE` — stdout rendering mode
- **Purpose**: chooses how partial and final transcript tokens hit stdout.
- **Storage**: project-local `.env` or shell.
- **Options**:
  - `overwrite` — partials overlay the current line via `\r`; finals terminate the line with `\n`. Default for TTYs.
  - `append` — every partial and every final is its own `\n`-terminated line. Pipe-safe.
  - `final-only` — partials suppressed; finals only.
- **Default**: `overwrite`.
- **Auto-downgrade**: when stdout is NOT a TTY (i.e. piped/redirected), `overwrite` silently becomes `append` to avoid `\r` artifacts in files. This applies even when `--output-mode overwrite` was explicit.

### 3.12 `MIC_TOOL_TS_GUARD_PHRASE` — turn-boundary phrase
- **Purpose**: phrase that closes the current turn when detected in the recent finalized transcript. On match, the renderer emits a blank line and (if refinement is enabled) sends the turn to the LLM.
- **Storage**: project-local `.env` if you want a project-specific phrase; otherwise use the default.
- **Options**: any non-empty string that contains at least one letter or digit AFTER normalization (NFD + strip combining marks + lowercase + collapse non-alphanumeric to space). Reject reasons: empty string, whitespace-only, punctuation-only.
- **Default**: `τέλος εντολής` (Greek for "end of instruction"). The phrase remains visible in the rendered transcript — it is only stripped from the input sent to the LLM.

### 3.13 `MIC_TOOL_TS_REFINE` — LLM refinement on/off
- **Purpose**: when true, each closed turn's text (with the guard phrase stripped) is sent to the configured LLM, and the cleaned response is rendered on its own line + a blank line.
- **Storage**: project-local `.env` if you have a stable preference; otherwise toggle per-invocation.
- **Options**: boolean (see §3.7 for accepted spellings). On the CLI, use `--refine` or `--no-refine`.
- **Default**: `true`.
- **Failure semantics**: runtime LLM failures are fail-open — the verbatim transcript continues; only the refined line is omitted. Startup misconfiguration (missing Azure env vars when refine is on) is fail-closed (exit code 2).

### 3.14 `MIC_TOOL_TS_LLM_PROVIDER` — LLM provider name
- **Purpose**: chooses which LLM family handles refinement.
- **Storage**: project-local `.env` or shell.
- **Options**: one of the eight project-standard names:
  - `azure-openai` — fully implemented in v1.
  - `openai`, `anthropic`, `google`, `azure-ai-inference`, `ollama`, `litellm`, `openai-compat` — accepted by validation but throw `LLMConfigurationError` at refiner construction with a message naming the env vars to set when the provider lands.
- **Default**: `azure-openai`.

### 3.15 `MIC_TOOL_TS_LLM_MODEL` — LLM model / deployment name
- **Purpose**: provider-specific model name. For Azure OpenAI, this is the *deployment* name (NOT the underlying model id) unless `AZURE_OPENAI_DEPLOYMENT` is set, in which case that wins.
- **Storage**: project-local `.env` or shell.
- **Options**: any non-empty string the provider accepts.
- **Default**: `gpt-5.4`.

### 3.16 `MIC_TOOL_TS_VERBOSE` — diagnostic stderr logging
- **Purpose**: emits one-line diagnostics for the major lifecycle events (config resolution, transcription state, LLM refinement, shutdown). stdout still contains transcript text only.
- **Storage**: shell (developer convenience) or `--verbose` flag for one-off debugging.
- **Options**: boolean.
- **Default**: `false`.

### 3.17 Voice-agent protocol settings
- **Purpose**: controls the deterministic oral command protocol layered over finalized STT text. Partial transcripts never trigger state changes.
- **Interaction modes**:
  - `dictation` — human transcript and processed-section output on stdout.
  - `agent-protocol` — JSONL protocol events on stdout; diagnostics remain on stderr.
  - `hybrid` — human transcript remains on stdout and JSONL events are written to `--protocol-output`.
- **Markers**: `MIC_TOOL_TS_COMMAND_PHRASE`, `MIC_TOOL_TS_SECTION_END_PHRASE`, `MIC_TOOL_TS_SECTION_CANCEL_PHRASE`, and `MIC_TOOL_TS_LITERAL_NEXT_PHRASE` must be non-empty. Defaults are `command`, `command send`, `command cancel`, and `literal phrase`.
- **Operators**: `MIC_TOOL_TS_REFINE_DEFAULT`, `MIC_TOOL_TS_TRANSLATE_DEFAULT`, and `MIC_TOOL_TS_CLIPBOARD_DEFAULT` set the initial persistent state for section processing. During a session, speak `command refine`, `command translate`, or `command clipboard` to enable an operator; add `off` to disable it.
- **Translation**: `MIC_TOOL_TS_TRANSLATION_POLICY` is one of `opposite`, `to-en`, or `to-el`. `opposite` translates Greek sections to English and English sections to Greek using simple complete-section language detection.
- **Remembered runtime state**: on graceful shutdown, the tool writes `~/.tool-agents/mic-tool-ts/state.json` with only non-secret protocol state: `refine`, `translate`, `clipboard`, and `translation_policy`. At startup, saved values are restored only when the corresponding CLI/env default is absent. Explicit `--refine-default`, `--translate-default`, `--clipboard-default`, or `--translation-policy` values override the saved state.
- **Stream separation**: if JSONL uses stdout (`agent-protocol`), human transcript text is not written to stdout. `hybrid` requires `MIC_TOOL_TS_PROTOCOL_OUTPUT` so streams are not silently mixed.

### 3.18 `AZURE_OPENAI_API_KEY` — Azure OpenAI key
- **Required when**: `--refine` is on AND provider is `azure-openai`.
- **Obtain**: Azure portal → your OpenAI resource → Keys and Endpoint.
- **Storage**: secrets-grade. `~/.tool-agents/mic-tool-ts/.env` (0600 in a 0700 folder) is the recommended location.
- **Options**: any non-empty string.
- **Default**: none. Missing → `LLMConfigurationError` at startup (exit 2).

### 3.19 `AZURE_OPENAI_ENDPOINT` — Azure OpenAI endpoint
- **Required when**: `--refine` is on AND provider is `azure-openai`.
- **Obtain**: Azure portal → your OpenAI resource → Keys and Endpoint. Usually `https://<resource-name>.openai.azure.com`.
- **Storage**: not a secret — but conventionally co-located with the key.
- **Options**: any URL. Trailing slashes are stripped by the refiner.
- **Default**: none. Missing → `LLMConfigurationError` at startup.

### 3.20 `AZURE_OPENAI_DEPLOYMENT` — Azure OpenAI deployment name (optional)
- **Purpose**: lets you decouple the CLI's `--llm-model` value from the deployment name. The deployment name appears in the URL path that the refiner POSTs to.
- **Obtain**: Azure portal → your OpenAI resource → Model deployments.
- **Storage**: project-local `.env` or shell.
- **Options**: any non-empty string.
- **Default**: when unset, the refiner uses the `--llm-model` value as the deployment name.

### 3.21 `AZURE_OPENAI_API_VERSION` — Azure OpenAI API version
- **Purpose**: pins the Chat Completions REST API version.
- **Obtain**: Azure docs — pick a non-preview, GA version that supports your deployment.
- **Storage**: project-local `.env` or shell.
- **Options**: any string Azure accepts as an `api-version` query parameter.
- **Default**: `2024-10-21`.

### 3.22 (Future) `AZURE_OPENAI_API_KEY_EXPIRES_AT` — Azure key renewal reminder
- **Status**: **NOT YET READ BY CODE.** Documented here per the `<configuration-guide>` rule for expiring credentials. Tracked as a pending item in `Issues - Pending Items.md`.
- **Purpose**: when implemented, will mirror `SONIOX_API_KEY_EXPIRES_AT` for the Azure OpenAI key.
- **Format**: `YYYY-MM-DD`.

---

## 4. Recommended storage layout

A canonical setup for the recommended secrets-grade per-user store:

```
~/.tool-agents/                            # mode 0700 (only you can read)
└── mic-tool-ts/                              # mode 0700
    ├── .env                               # mode 0600
    └── state.json                         # mode 0600, non-secret runtime protocol state

# .env contents (example):
SONIOX_API_KEY=sk_real_key_here
SONIOX_API_KEY_EXPIRES_AT=2026-11-15
ELEVENLABS_API_KEY=xi_real_key_here
ELEVENLABS_API_KEY_EXPIRES_AT=2026-11-15
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=https://my-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=gpt-5.4
AZURE_OPENAI_API_VERSION=2024-10-21
```

Create the folder once:

```
mkdir -m 0700 -p ~/.tool-agents/mic-tool-ts
touch ~/.tool-agents/mic-tool-ts/.env
chmod 0600 ~/.tool-agents/mic-tool-ts/.env
# then edit the file in your preferred editor
```

`mic-tool-ts` creates `~/.tool-agents/mic-tool-ts/state.json` when it saves remembered protocol settings. It does not create or populate `.env`; you still own secret setup and review.

For non-secret project-specific overrides (e.g. `MIC_TOOL_TS_LANGUAGES=pt-BR,en` for a Portuguese project), use a project-local `<cwd>/.env`. Do NOT put secrets in this file if the project is under version control.

---

## 5. CLI examples

```
# Minimal: relies on ~/.tool-agents/mic-tool-ts/.env or shell for SONIOX_API_KEY
mic-tool-ts

# Override languages for one run
mic-tool-ts --language pt-BR --language en

# Pipe to a file (auto-downgrades overwrite → append)
mic-tool-ts > session.txt

# Disable LLM refinement
mic-tool-ts --no-refine

# Diagnostic / debug
mic-tool-ts --verbose

# Custom guard phrase
mic-tool-ts --guard-phrase "stop please"

# Custom Soniox model + endpoint
mic-tool-ts --model stt-rt-v4 --endpoint wss://stt-rt.soniox.com/transcribe-websocket

# Use ElevenLabs Scribe Realtime
mic-tool-ts --stt-provider elevenlabs --elevenlabs-api-key xi_...

# JSONL voice-agent protocol on stdout
mic-tool-ts --interaction-mode agent-protocol --no-refine

# Human transcript on stdout, protocol events in a JSONL file
mic-tool-ts --interaction-mode hybrid --protocol-output ./agent-events.jsonl --no-refine
```

---

## 6. Validation rules summary

| Parameter            | Rule                                                         | Error class                  |
|----------------------|--------------------------------------------------------------|------------------------------|
| `sttProvider`        | One of `soniox` / `elevenlabs`                               | `InvalidConfigurationError`  |
| `apiKey`             | Trim non-empty                                                | `MissingConfigurationError`  |
| `apiKeyExpiresAt`    | `YYYY-MM-DD`, round-trips via `Date.UTC`                      | `InvalidConfigurationError`  |
| `model`              | Trim non-empty                                                | `InvalidConfigurationError`  |
| `endpoint`           | `^wss?://[^\s]+$`                                             | `InvalidConfigurationError`  |
| `languages`          | Each item: `^[a-z]{2,3}(-[A-Z]{2})?$` OR sole `auto`; ElevenLabs accepts one explicit code only | `InvalidConfigurationError`  |
| `sampleRate`         | Positive integer in `[8000, 48000]`                           | `InvalidConfigurationError`  |
| `outputMode`         | One of `overwrite` / `append` / `final-only`                  | `InvalidConfigurationError`  |
| `guardPhrase`        | Trim non-empty AND normalizes to non-empty                    | `InvalidConfigurationError`  |
| `interactionMode`    | One of `dictation` / `agent-protocol` / `hybrid`              | `InvalidConfigurationError`  |
| Protocol markers     | Trim non-empty                                                | `InvalidConfigurationError`  |
| `translationPolicy`  | One of `opposite` / `to-en` / `to-el`                         | `InvalidConfigurationError`  |
| `protocolOutput`     | Required when `interactionMode=hybrid`                        | `InvalidConfigurationError`  |
| `llmProvider`        | One of the eight `LLM_PROVIDERS`                              | `InvalidConfigurationError`  |
| `llmModel`           | Trim non-empty                                                | `InvalidConfigurationError`  |
| All booleans         | `true|false|yes|no|on|off|1|0` (case-insensitive)             | `InvalidConfigurationError`  |
| Azure config (when refine on) | `AZURE_OPENAI_API_KEY` and `AZURE_OPENAI_ENDPOINT` both present | `LLMConfigurationError`      |

Every `InvalidConfigurationError` message names BOTH the CLI flag AND the env var so you can fix whichever you set. Every fatal config error exits with code 2.
