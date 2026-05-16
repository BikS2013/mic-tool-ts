# mic-tool — Configuration Guide

This document is the authoritative reference for every configuration parameter `mic-tool` accepts: where each value can come from, how the resolver picks between sources, how to obtain each value, and where the user is recommended to store it. It satisfies the project-wide `<configuration-guide>` rule from `~/.claude/CLAUDE.md`.

See also:
- `docs/design/project-design.md` §14 — implementation specification of the four-tier chain.
- `docs/design/project-functions.md` FR-15..FR-17 / NFR-8..NFR-10 — formal requirements.
- `docs/design/plan-004-env-var-fallbacks-and-docs.md` — the plan that introduced the full schema.

---

## 1. Configuration sources and their priority

`mic-tool` resolves every configurable value by walking four sources in this order — the first source that yields a non-whitespace value wins:

```
+----------------------+   highest priority
| 1. CLI flag          |   --api-key sk_...
+----------------------+
| 2. <cwd>/.env        |   project-local; checked into git? NEVER for secrets.
+----------------------+
| 3. ~/.tool-agents/   |   per-user, secrets-grade.
|    mic-tool/.env     |   Folder mode 0700, file mode 0600.
+----------------------+
| 4. process.env       |   shell environment (export VAR=...)
+----------------------+   lowest priority
```

Notes:
- Whitespace-only values are treated as missing. A `.env` file containing `SONIOX_API_KEY=   ` does NOT satisfy the resolver — it will fall through to the next tier.
- `mic-tool` never mutates `process.env`. The chain is read-only.
- The two `.env` files are optional. Missing files are not errors; malformed files (e.g. unterminated quote) raise `InvalidConfigurationError` so you are never silently deprived of a value you thought was loaded.
- Run with `--verbose` to see which source supplied the Soniox API key. The value itself is never logged.

### Example resolution

You set:

```
# in ~/.tool-agents/mic-tool/.env
SONIOX_API_KEY=sk_user_default
MIC_TOOL_LANGUAGES=el,en

# in ./.env (project-local)
MIC_TOOL_LANGUAGES=en

# in your shell
export SONIOX_API_KEY=sk_shell_value
```

And invoke:

```
mic-tool --language pt
```

The resolver yields:

| Value          | Source picked                | Why                                                         |
|----------------|------------------------------|-------------------------------------------------------------|
| `apiKey`       | `~/.tool-agents/.../.env`    | No CLI flag, no local `.env` value; user-env tier wins over shell env. |
| `languages`    | CLI flag (`["pt"]`)          | Flag beats every env-var tier.                              |

---

## 2. Parameter reference

The table below is the complete contract. The "Default" column shows the value used when neither a flag nor any env-var tier supplies a value.

| CLI flag                            | Env var                                | Default                                              | Required? |
|-------------------------------------|----------------------------------------|------------------------------------------------------|-----------|
| `--api-key <value>`                 | `SONIOX_API_KEY`                       | _none_                                               | **yes**   |
| `--api-key-expires-at <YYYY-MM-DD>` | `SONIOX_API_KEY_EXPIRES_AT`            | _unset_                                              | no        |
| `--model <name>`                    | `MIC_TOOL_MODEL`                       | `stt-rt-v4`                                          | no        |
| `--endpoint <wss-url>`              | `MIC_TOOL_ENDPOINT`                    | `wss://stt-rt.soniox.com/transcribe-websocket`       | no        |
| `--language <code>` (repeatable)    | `MIC_TOOL_LANGUAGES` (CSV)             | `el,en`                                              | no        |
| `--sample-rate <hz>`                | `MIC_TOOL_SAMPLE_RATE`                 | `16000`                                              | no        |
| `--no-endpoint-detection`           | `MIC_TOOL_ENABLE_ENDPOINT_DETECTION`   | `true`                                               | no        |
| `--output-mode <mode>`              | `MIC_TOOL_OUTPUT_MODE`                 | `overwrite`                                          | no        |
| `--guard-phrase <phrase>`           | `MIC_TOOL_GUARD_PHRASE`                | `τέλος εντολής`                                      | no        |
| `--refine` / `--no-refine`          | `MIC_TOOL_REFINE`                      | `true`                                               | no        |
| `--llm-provider <name>`             | `MIC_TOOL_LLM_PROVIDER`                | `azure-openai`                                       | no        |
| `--llm-model <name>`                | `MIC_TOOL_LLM_MODEL`                   | `gpt-5.4`                                            | no        |
| `-v, --verbose`                     | `MIC_TOOL_VERBOSE`                     | `false`                                              | no        |

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
- **Storage**: secrets-grade. Store in `~/.tool-agents/mic-tool/.env` (folder 0700, file 0600). Never check into git. Never paste into a shared chat.
- **Options**: a non-empty string after trimming. No fallback — a missing key raises `MissingConfigurationError` with exit code 2.
- **Default**: none.

### 3.2 `SONIOX_API_KEY_EXPIRES_AT` — Soniox key renewal reminder (optional)
- **Purpose**: operational reminder. When set, the tool checks at startup and writes a single stderr warning if the key is within 14 days of expiry, or has already expired.
- **Obtain**: read it off the Soniox console, or set it to whatever date your team decided is a "renew by" date.
- **Storage**: anywhere — this is not a secret. Living alongside `SONIOX_API_KEY` in `~/.tool-agents/mic-tool/.env` is the recommended pairing so the reminder cannot drift away from the key.
- **Options / format**: `YYYY-MM-DD`. The parser round-trips through `Date.UTC` so calendar-invalid values like `2026-02-30` are rejected.
- **Default**: unset → expiry tracking is disabled.
- **Behaviour**:
  - `> 14 days` away → silent (verbose only).
  - `1..14 days` away → `[mic-tool] WARNING: SONIOX_API_KEY expires in N days (YYYY-MM-DD). Plan a renewal.`
  - Past expiry → `[mic-tool] WARNING: SONIOX_API_KEY expired N days ago (YYYY-MM-DD). Renew at https://console.soniox.com.`
  - The tool always tries to run; expiry is operational, not enforcement.

### 3.3 `MIC_TOOL_MODEL` — Soniox real-time model
- **Purpose**: selects the Soniox real-time STT model that processes your audio.
- **Obtain**: see the Soniox model catalog. `stt-rt-v4` is the v4 multilingual real-time model and is the v1 default.
- **Storage**: project-local `.env` or shell — not a secret.
- **Options**: any string Soniox accepts as a `model` in the session config. v1 is tested against `stt-rt-v4`.
- **Default**: `stt-rt-v4`.

### 3.4 `MIC_TOOL_ENDPOINT` — Soniox WebSocket endpoint
- **Purpose**: lets you point the tool at a non-default Soniox endpoint (regional, staging, or a future EU-resident endpoint).
- **Obtain**: from Soniox.
- **Storage**: project-local `.env` or shell.
- **Options**: must be a valid `wss://` (preferred) or `ws://` URL.
- **Default**: `wss://stt-rt.soniox.com/transcribe-websocket`.

### 3.5 `MIC_TOOL_LANGUAGES` — language hints
- **Purpose**: tells Soniox which languages to expect. Improves accuracy for code-switched dictation (e.g. Greek + English).
- **Obtain**: ISO 639-1 (`en`) or 639-2 (`eng`) codes; regional variants supported as `pt-BR`.
- **Storage**: project-local `.env` if your project has a stable language pair; otherwise pass via CLI.
- **Options**:
  - A CSV string (env var): `el,en` → `["el", "en"]`.
  - A repeated flag (CLI): `--language el --language en`.
  - The single literal `auto` enables Soniox auto-detection (translated to `enable_language_identification: true` with no `language_hints`). `auto` cannot be combined with any other code.
- **Default**: `el,en` (Greek + English) — chosen because the tool was authored in a Greek-language project.

### 3.6 `MIC_TOOL_SAMPLE_RATE` — PCM sample rate (Hz)
- **Purpose**: drives BOTH the `sox` capture argv (`-r <value>`) AND the Soniox session config (`sample_rate`). They MUST match — `mic-tool` keeps them in lockstep from a single value.
- **Obtain**: just pick a supported rate; `16000` is the canonical rate for real-time STT.
- **Storage**: project-local `.env` or shell.
- **Options**: a positive integer in `[8000, 48000]`. Common values: `16000`, `24000`, `48000`.
- **Default**: `16000`.

### 3.7 `MIC_TOOL_ENABLE_ENDPOINT_DETECTION` — server-side endpoint detection
- **Purpose**: when `true`, Soniox emits `endpoint` markers that promote partials to finals at natural utterance boundaries. When `false`, you rely on the SDK's per-token finality only.
- **Obtain**: pick a boolean.
- **Storage**: project-local `.env` or shell.
- **Options**: `true` / `false` / `yes` / `no` / `on` / `off` / `1` / `0` (case-insensitive). The CLI side uses the flag `--no-endpoint-detection` to set it to `false`; there is no `--endpoint-detection` flag because the default is already on.
- **Default**: `true`.

### 3.8 `MIC_TOOL_OUTPUT_MODE` — stdout rendering mode
- **Purpose**: chooses how partial and final transcript tokens hit stdout.
- **Storage**: project-local `.env` or shell.
- **Options**:
  - `overwrite` — partials overlay the current line via `\r`; finals terminate the line with `\n`. Default for TTYs.
  - `append` — every partial and every final is its own `\n`-terminated line. Pipe-safe.
  - `final-only` — partials suppressed; finals only.
- **Default**: `overwrite`.
- **Auto-downgrade**: when stdout is NOT a TTY (i.e. piped/redirected), `overwrite` silently becomes `append` to avoid `\r` artifacts in files. This applies even when `--output-mode overwrite` was explicit.

### 3.9 `MIC_TOOL_GUARD_PHRASE` — turn-boundary phrase
- **Purpose**: phrase that closes the current turn when detected in the recent finalized transcript. On match, the renderer emits a blank line and (if refinement is enabled) sends the turn to the LLM.
- **Storage**: project-local `.env` if you want a project-specific phrase; otherwise use the default.
- **Options**: any non-empty string that contains at least one letter or digit AFTER normalization (NFD + strip combining marks + lowercase + collapse non-alphanumeric to space). Reject reasons: empty string, whitespace-only, punctuation-only.
- **Default**: `τέλος εντολής` (Greek for "end of instruction"). The phrase remains visible in the rendered transcript — it is only stripped from the input sent to the LLM.

### 3.10 `MIC_TOOL_REFINE` — LLM refinement on/off
- **Purpose**: when true, each closed turn's text (with the guard phrase stripped) is sent to the configured LLM, and the cleaned response is rendered on its own line + a blank line.
- **Storage**: project-local `.env` if you have a stable preference; otherwise toggle per-invocation.
- **Options**: boolean (see §3.7 for accepted spellings). On the CLI, use `--refine` or `--no-refine`.
- **Default**: `true`.
- **Failure semantics**: runtime LLM failures are fail-open — the verbatim transcript continues; only the refined line is omitted. Startup misconfiguration (missing Azure env vars when refine is on) is fail-closed (exit code 2).

### 3.11 `MIC_TOOL_LLM_PROVIDER` — LLM provider name
- **Purpose**: chooses which LLM family handles refinement.
- **Storage**: project-local `.env` or shell.
- **Options**: one of the eight project-standard names:
  - `azure-openai` — fully implemented in v1.
  - `openai`, `anthropic`, `google`, `azure-ai-inference`, `ollama`, `litellm`, `openai-compat` — accepted by validation but throw `LLMConfigurationError` at refiner construction with a message naming the env vars to set when the provider lands.
- **Default**: `azure-openai`.

### 3.12 `MIC_TOOL_LLM_MODEL` — LLM model / deployment name
- **Purpose**: provider-specific model name. For Azure OpenAI, this is the *deployment* name (NOT the underlying model id) unless `AZURE_OPENAI_DEPLOYMENT` is set, in which case that wins.
- **Storage**: project-local `.env` or shell.
- **Options**: any non-empty string the provider accepts.
- **Default**: `gpt-5.4`.

### 3.13 `MIC_TOOL_VERBOSE` — diagnostic stderr logging
- **Purpose**: emits one-line diagnostics for the major lifecycle events (config resolution, transcription state, LLM refinement, shutdown). stdout still contains transcript text only.
- **Storage**: shell (developer convenience) or `--verbose` flag for one-off debugging.
- **Options**: boolean.
- **Default**: `false`.

### 3.14 `AZURE_OPENAI_API_KEY` — Azure OpenAI key
- **Required when**: `--refine` is on AND provider is `azure-openai`.
- **Obtain**: Azure portal → your OpenAI resource → Keys and Endpoint.
- **Storage**: secrets-grade. `~/.tool-agents/mic-tool/.env` (0600 in a 0700 folder) is the recommended location.
- **Options**: any non-empty string.
- **Default**: none. Missing → `LLMConfigurationError` at startup (exit 2).

### 3.15 `AZURE_OPENAI_ENDPOINT` — Azure OpenAI endpoint
- **Required when**: `--refine` is on AND provider is `azure-openai`.
- **Obtain**: Azure portal → your OpenAI resource → Keys and Endpoint. Usually `https://<resource-name>.openai.azure.com`.
- **Storage**: not a secret — but conventionally co-located with the key.
- **Options**: any URL. Trailing slashes are stripped by the refiner.
- **Default**: none. Missing → `LLMConfigurationError` at startup.

### 3.16 `AZURE_OPENAI_DEPLOYMENT` — Azure OpenAI deployment name (optional)
- **Purpose**: lets you decouple the CLI's `--llm-model` value from the deployment name. The deployment name appears in the URL path that the refiner POSTs to.
- **Obtain**: Azure portal → your OpenAI resource → Model deployments.
- **Storage**: project-local `.env` or shell.
- **Options**: any non-empty string.
- **Default**: when unset, the refiner uses the `--llm-model` value as the deployment name.

### 3.17 `AZURE_OPENAI_API_VERSION` — Azure OpenAI API version
- **Purpose**: pins the Chat Completions REST API version.
- **Obtain**: Azure docs — pick a non-preview, GA version that supports your deployment.
- **Storage**: project-local `.env` or shell.
- **Options**: any string Azure accepts as an `api-version` query parameter.
- **Default**: `2024-10-21`.

### 3.18 (Future) `AZURE_OPENAI_API_KEY_EXPIRES_AT` — Azure key renewal reminder
- **Status**: **NOT YET READ BY CODE.** Documented here per the `<configuration-guide>` rule for expiring credentials. Tracked as a pending item in `Issues - Pending Items.md`.
- **Purpose**: when implemented, will mirror `SONIOX_API_KEY_EXPIRES_AT` for the Azure OpenAI key.
- **Format**: `YYYY-MM-DD`.

---

## 4. Recommended storage layout

A canonical setup for the recommended secrets-grade per-user store:

```
~/.tool-agents/                            # mode 0700 (only you can read)
└── mic-tool/                              # mode 0700
    └── .env                               # mode 0600

# .env contents (example):
SONIOX_API_KEY=sk_real_key_here
SONIOX_API_KEY_EXPIRES_AT=2026-11-15
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=https://my-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=gpt-5.4
AZURE_OPENAI_API_VERSION=2024-10-21
```

Create the folder once:

```
mkdir -m 0700 -p ~/.tool-agents/mic-tool
touch ~/.tool-agents/mic-tool/.env
chmod 0600 ~/.tool-agents/mic-tool/.env
# then edit the file in your preferred editor
```

`mic-tool` does NOT create this folder for you — that is a deliberate choice (no runtime side-effects on first run; the user controls the file's existence and permissions).

For non-secret project-specific overrides (e.g. `MIC_TOOL_LANGUAGES=pt-BR,en` for a Portuguese project), use a project-local `<cwd>/.env`. Do NOT put secrets in this file if the project is under version control.

---

## 5. CLI examples

```
# Minimal: relies on ~/.tool-agents/mic-tool/.env or shell for SONIOX_API_KEY
mic-tool

# Override languages for one run
mic-tool --language pt-BR --language en

# Pipe to a file (auto-downgrades overwrite → append)
mic-tool > session.txt

# Disable LLM refinement
mic-tool --no-refine

# Diagnostic / debug
mic-tool --verbose

# Custom guard phrase
mic-tool --guard-phrase "stop please"

# Custom Soniox model + endpoint
mic-tool --model stt-rt-v4 --endpoint wss://stt-rt.soniox.com/transcribe-websocket
```

---

## 6. Validation rules summary

| Parameter            | Rule                                                         | Error class                  |
|----------------------|--------------------------------------------------------------|------------------------------|
| `apiKey`             | Trim non-empty                                                | `MissingConfigurationError`  |
| `apiKeyExpiresAt`    | `YYYY-MM-DD`, round-trips via `Date.UTC`                      | `InvalidConfigurationError`  |
| `model`              | Trim non-empty                                                | `InvalidConfigurationError`  |
| `endpoint`           | `^wss?://[^\s]+$`                                             | `InvalidConfigurationError`  |
| `languages`          | Each item: `^[a-z]{2,3}(-[A-Z]{2})?$` OR sole `auto`          | `InvalidConfigurationError`  |
| `sampleRate`         | Positive integer in `[8000, 48000]`                           | `InvalidConfigurationError`  |
| `outputMode`         | One of `overwrite` / `append` / `final-only`                  | `InvalidConfigurationError`  |
| `guardPhrase`        | Trim non-empty AND normalizes to non-empty                    | `InvalidConfigurationError`  |
| `llmProvider`        | One of the eight `LLM_PROVIDERS`                              | `InvalidConfigurationError`  |
| `llmModel`           | Trim non-empty                                                | `InvalidConfigurationError`  |
| All booleans         | `true|false|yes|no|on|off|1|0` (case-insensitive)             | `InvalidConfigurationError`  |
| Azure config (when refine on) | `AZURE_OPENAI_API_KEY` and `AZURE_OPENAI_ENDPOINT` both present | `LLMConfigurationError`      |

Every `InvalidConfigurationError` message names BOTH the CLI flag AND the env var so you can fix whichever you set. Every fatal config error exits with code 2.
