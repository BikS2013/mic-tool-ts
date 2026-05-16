# plan-004 — Full env-var fallbacks for every flag + doc backfill

## Goal
Wire env-var fallbacks for every CLI flag through the existing four-tier
resolution chain (CLI flag > local `.env` > `~/.tool-agents/mic-tool-ts/.env` >
shell env). Add operational expiry tracking for the Soniox API key. Backfill
all design / functional / configuration documentation that lagged behind
plans 002 and 003.

## Final config schema

### CLI flags + env-var aliases

| CLI flag                          | Env var                                | Default                                              |
|-----------------------------------|----------------------------------------|------------------------------------------------------|
| `--api-key <value>`               | `SONIOX_API_KEY`                       | _required_                                           |
| `--api-key-expires-at <YYYY-MM-DD>` | `SONIOX_API_KEY_EXPIRES_AT`           | _unset_ (operational reminder)                       |
| `--model <name>`                  | `MIC_TOOL_TS_MODEL`                       | `stt-rt-v4`                                          |
| `--endpoint <wss-url>`            | `MIC_TOOL_TS_ENDPOINT`                    | `wss://stt-rt.soniox.com/transcribe-websocket`       |
| `--language <code>` (repeatable)  | `MIC_TOOL_TS_LANGUAGES` (CSV)             | `el,en`                                              |
| `--sample-rate <hz>`              | `MIC_TOOL_TS_SAMPLE_RATE`                 | `16000`                                              |
| `--no-endpoint-detection`         | `MIC_TOOL_TS_ENABLE_ENDPOINT_DETECTION`   | `true`                                               |
| `--guard-phrase <phrase>`         | `MIC_TOOL_TS_GUARD_PHRASE`                | `τέλος εντολής`                                      |
| `--output-mode <mode>`            | `MIC_TOOL_TS_OUTPUT_MODE`                 | `overwrite`                                          |
| `--refine` / `--no-refine`        | `MIC_TOOL_TS_REFINE` (bool)               | `true`                                               |
| `--llm-provider <name>`           | `MIC_TOOL_TS_LLM_PROVIDER`                | `azure-openai`                                       |
| `--llm-model <name>`              | `MIC_TOOL_TS_LLM_MODEL`                   | `gpt-5.4`                                            |
| `-v, --verbose`                   | `MIC_TOOL_TS_VERBOSE` (bool)              | `false`                                              |

Boolean env var parsing accepts `true|false|yes|no|on|off|1|0` (case-insensitive).

### Type changes
- `ResolvedConfig.language: string` → `ResolvedConfig.languages: string[]`
- New fields: `model`, `endpoint`, `sampleRate`, `enableEndpointDetection`, `apiKeyExpiresAt?`
- Soniox session config: `language_hints` becomes the array as-is; if `["auto"]`, switch to `enable_language_identification: true`; otherwise pass the array as `language_hints`.

### Expiry behaviour
If `SONIOX_API_KEY_EXPIRES_AT` is set:
- Parse as `YYYY-MM-DD` (UTC midnight).
- If now > expiry → write a warning to stderr: `[mic-tool-ts] WARNING: SONIOX_API_KEY expired N days ago (YYYY-MM-DD). Renew at https://console.soniox.com.`
- Else if now within 14 days of expiry → `[mic-tool-ts] WARNING: SONIOX_API_KEY expires in N days (YYYY-MM-DD).`
- Else verbose only.
The tool still attempts to run regardless — the user owns renewal.

### Endpoint override
`SonioxNodeClient` constructor accepts `stt_ws_url` per the SDK type definitions. We pass through `endpoint` when it differs from the SDK default.

### Sample-rate impact
- `sox` spawn argv must use the same rate (`-r <value>`).
- Soniox session `sample_rate` must match.
- We validate the rate is a positive integer between 8000 and 48000.

## Implementation steps

1. **Add a tiny boolean / numeric parser** in `src/config/parsers.ts` for env-var coercion (boolean, positive integer, ISO date).
2. **Refactor `src/config.ts`**:
   - New fields on `ResolvedConfig` + new validators.
   - For every flag with an env-var alias, the resolver consults the env chain when the flag wasn't supplied.
3. **Add `src/config/expiry.ts`** to compute the warning level + emit the line to stderr at startup.
4. **Refactor `src/soniox/client.ts`** so `TranscriberOptions` takes `model`, `endpoint`, `languages`, `sampleRate`, `enableEndpointDetection`. Pass `stt_ws_url` to `SonioxNodeClient`.
5. **Refactor `src/mic/soxMicSource.ts`** so the constructor takes `sampleRate`. Update spawn argv. Also export `AUDIO_SAMPLE_RATE` constant only as a hint; the runtime value comes from config.
6. **Update `src/main.ts`** to pass all new fields and call `checkApiKeyExpiry()` after config resolution.
7. **Tests** — update fixtures across all test files; add new tests for:
   - Boolean / numeric env-var parsing
   - Languages from CSV env var
   - Sample-rate validation (positive int, range)
   - Endpoint URL must be `wss://` or `ws://`
   - Expiry warning levels
8. **Docs**:
   - Update `project-design.md` with §12 (Turn detection), §13 (LLM refinement), §14 (Configuration & env-var chain).
   - Update `project-functions.md` with FR-12..FR-22 and NFR-8..NFR-10.
   - Create `configuration-guide.md` covering every flag, every env var, every default, every secret-handling recommendation, including the expiry-tracking pattern per CLAUDE.md `<configuration-guide>` rules.
   - Update `README.md` from placeholder to real usage doc.
   - Update `Issues - Pending Items.md` — close items that are now done; surface new items.

## Backwards compatibility
- `--language en` continues to work (commander variadic accepts a single repetition or comma-split alternatives).
- All existing tests that use `--language en` will pass once we accept comma-split too.
- `language: string` becomes `languages: string[]` — every test fixture updated.

## Non-goals
- Adding a `--regenerate` command for the LLM.
- Implementing the other 7 LLM providers.
- Streaming the LLM response token-by-token.
- Auto-renew of the API key.
