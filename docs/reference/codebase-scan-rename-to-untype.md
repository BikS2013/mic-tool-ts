---
language: typescript
framework: electron
package_manager: pnpm
build_command: "tsc -p . && mkdir -p dist/ui/renderer && cp src/ui/renderer/index.html src/ui/renderer/styles.css src/ui/renderer/overlay.html src/ui/renderer/overlay.css dist/ui/renderer/ && node scripts/build-native-helper.mjs"
test_command: vitest run
lint_command: null
entry_points:
  - src/index.ts
  - src/main.ts
  - src/ui/electronMain.ts
last_scanned_commit: b63e025c1e02f01c86af5c9c0039c25035d28c04
scanned_for_request: refined-request-rename-to-untype
scanned_at: "2026-05-23T19:15:00Z"
electron_build_config: null
electron_productName_in_code: "\"mic-tool-ts\" (src/ui/electronMain.ts:234 window title; ipcMain channel prefix lines 178–651)"
bin_directory_exists: false
---

# Codebase Scan — mic-tool-ts (rename to untype)

## 1. Project Overview

TypeScript CLI/Electron desktop application (`"type": "module"`, Node `>=20.12`) managed with
`pnpm`. The project captures macOS microphone audio, streams it to Soniox or ElevenLabs STT,
detects turn boundaries, and optionally refines transcripts via an LLM. The Electron layer adds a
floating overlay UI and system-wide hotkey handling. No `electron-builder.yml` or
`forge.config.*` file is present — Electron is a runtime dependency only (`"electron": "^42.1.0"`
in `dependencies`), not an Electron-Forge/Builder project. The `bin` field in `package.json`
currently maps the key `"mic-tool-ts"` to `./dist/index.js`.

**Electron `productName` / `name` in build config:** No `electron-builder.yml` or
`forge.config.*` exists; `package.json` has no `productName` or `appId` field. The name is
embedded at runtime in source code (`electronMain.ts`) via the window title string `"mic-tool-ts"`
and as the IPC channel name prefix `"mic-tool-ts:"`.

**`bin/` directory:** Does NOT exist at the project root. The `bin` field in `package.json` points
directly to `./dist/index.js`. No wrapper script needs to be renamed on disk.

## 2. Module Map

| Path | Purpose | Representative symbols |
|---|---|---|
| `src/index.ts` | CLI entry; dispatches to Electron main or headless mode | `main` (top-level) |
| `src/main.ts` | Headless CLI bootstrap | `main` |
| `src/config.ts` | All env-var and config-path resolution; references `~/.tool-agents/mic-tool-ts/` | `resolveConfig`, `CONFIG_TOOL_NAME`, `MIC_TOOL_TS_*` |
| `src/config/envChain.ts` | Multi-source env var resolver helper | `loadEnvChain` |
| `src/config/expiry.ts` | API key expiry checking | `checkExpiry` |
| `src/core/sessionRunner.ts` | Orchestrates a transcription session | `SessionRunner` |
| `src/errors.ts` | Typed error classes | `ConfigError`, `MicError` |
| `src/soniox/client.ts` | Soniox real-time STT client | `SonioxClient` |
| `src/elevenlabs/client.ts` | ElevenLabs STT client | `ElevenLabsClient` |
| `src/llm/azureOpenAI.ts` | Azure OpenAI LLM refinement | `refineWithAzure` |
| `src/llm/google.ts` | Google Gemini LLM refinement | `refineWithGoogle` |
| `src/mic/index.ts` | Microphone abstraction | `createMicSource` |
| `src/mic/soxMicSource.ts` | SoX-based mic capture | `SoxMicSource` |
| `src/turn/detector.ts` | Guard-phrase turn boundary detection | `TurnDetector` |
| `src/protocol/controller.ts` | Voice-agent command protocol | `ProtocolController` |
| `src/protocol/types.ts` | Protocol type definitions | `ProtocolKey` |
| `src/ui/electronMain.ts` | Electron main process; IPC handlers; window management | `createMainWindow`, ipcMain handlers |
| `src/ui/preload.cts` | Electron contextBridge / preload; IPC channel names | `electronAPI` |
| `src/ui/renderer/app.ts` | Renderer process UI logic | `initApp` |
| `src/ui/renderer/index.html` | Main window HTML | — |
| `src/ui/renderer/overlay.html` | Overlay window HTML | — |
| `src/ui/runtimeSettings.ts` | In-process runtime settings store | `RuntimeSettings` |
| `src/ui/transcriptionOverlay.ts` | Overlay window controller | `TranscriptionOverlay` |
| `src/platform/macos/focusedInputHelper.ts` | macOS focused-input helper | `FocusedInputHelper` |
| `native/macos/input-helper/main.swift` | Swift native helper binary | — |
| `scripts/build-native-helper.mjs` | Build script for Swift native helper | — |
| `tests/` | Vitest test suite (14 test files) | — |
| `test_scripts/` | Manual smoke / sanity scripts | — |
| `docs/tools/mic-tool-ts.md` | Tool documentation file (must be renamed) | — |
| `docs/design/project-design.md` | Living design document (51 occurrences) | — |
| `docs/design/project-functions.md` | Living functional requirements (13 occurrences) | — |
| `docs/design/configuration-guide.md` | Living configuration guide (35 occurrences) | — |

## 3. Conventions

- **Config-path constant:** `src/config.ts` hardcodes `toolName: "mic-tool-ts"` and the env-var
  prefix `MIC_TOOL_TS_` throughout (~20 occurrences). The tool name propagates to
  `~/.tool-agents/mic-tool-ts/` path resolution (`src/config.ts`).
- **IPC channel naming:** All Electron IPC channels use `"mic-tool-ts:"` as a prefix (e.g.
  `"mic-tool-ts:settings:load"`). This appears in both `src/ui/electronMain.ts` (~17 occurrences)
  and `src/ui/preload.cts` (~9 occurrences); both files must be updated atomically.
- **Window title:** `src/ui/electronMain.ts:234` sets `title: "mic-tool-ts"` — a user-visible
  runtime string.
- **`loadEnvChain` call:** `src/ui/electronMain.ts:651` passes `{ toolName: "mic-tool-ts" }` to
  the env-chain loader; `src/config/envChain.ts` also contains the string.
- **Test files reference the tool name in paths/strings:** Most test files import config helpers
  that resolve `~/.tool-agents/mic-tool-ts/` paths, so they carry the old name in expected path
  assertions.

## 4. Integration Points

### Grep summary

Running `grep -rln "mic-tool-ts" ... --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git` found **~120 files** with a total of **715 line-occurrences**.

---

### In-Scope (must rename)

Files that are NOT historical artifacts and must have every occurrence of `mic-tool-ts` replaced
with `untype`:

| File (relative to project root) | Occurrences | Category | Notes |
|---|---|---|---|
| `package.json` | 2 | package manifest | `name` field + `bin` key |
| `CLAUDE.md` | 4 | project CLAUDE.md | "Project Tool Invocation" + "Tools" sections |
| `AGENTS.md` | 4 | config file / agent manifest | References tool name and config folder path |
| `README.md` | 41 | README | Primary user-facing documentation |
| `Issues - Pending Items.md` | 16 | issues tracker | Existing references; migration note to be added |
| `docs/tools/mic-tool-ts.md` | 11 | tool documentation | Must be **renamed** to `docs/tools/untype.md` and content updated |
| `docs/design/project-design.md` | 51 | living design doc | Authoritative design — must be updated |
| `docs/design/project-functions.md` | 13 | living functional requirements | Must be updated |
| `docs/design/configuration-guide.md` | 35 | living config guide | Must be updated |
| `scripts/build-native-helper.mjs` | 5 | scripts | Build helper script |
| `native/macos/input-helper/main.swift` | 1 | source code (Swift) | Native helper references tool name |
| `src/config.ts` | 20 | source code | Config-path constants and env-var prefix `MIC_TOOL_TS_` |
| `src/config/envChain.ts` | 1 | source code | `toolName` literal |
| `src/config/expiry.ts` | 4 | source code | References tool name in error/log messages |
| `src/core/sessionRunner.ts` | 12 | source code | Log message prefix `[mic-tool-ts]` |
| `src/elevenlabs/client.ts` | 9 | source code | Log/error message prefix |
| `src/errors.ts` | 1 | source code | Error message string |
| `src/llm/azureOpenAI.ts` | 1 | source code | Log message prefix |
| `src/llm/google.ts` | 1 | source code | Log message prefix |
| `src/mic/index.ts` | 1 | source code | Log message prefix |
| `src/mic/soxMicSource.ts` | 2 | source code | Log message prefix |
| `src/platform/macos/focusedInputHelper.ts` | 2 | source code | References tool name |
| `src/protocol/controller.ts` | 12 | source code | Log/error messages |
| `src/protocol/types.ts` | 1 | source code | Type or constant string |
| `src/soniox/client.ts` | 15 | source code | Log/error message prefix |
| `src/turn/detector.ts` | 2 | source code | Log message prefix |
| `src/ui/electronMain.ts` | 17 | source code | IPC channel prefix `"mic-tool-ts:"`, window title, log messages, `toolName` arg |
| `src/ui/preload.cts` | 9 | source code | IPC channel names (must match electronMain.ts exactly) |
| `src/ui/renderer/app.ts` | 1 | source code | Renderer reference |
| `src/ui/renderer/index.html` | 2 | source code (HTML) | UI title or string literal |
| `src/ui/renderer/overlay.html` | 1 | source code (HTML) | UI string |
| `src/ui/runtimeSettings.ts` | 1 | source code | String reference |
| `src/ui/transcriptionOverlay.ts` | 1 | source code | String reference |
| `test_scripts/focused-input-helper-smoke.sh` | 2 | scripts | Smoke test references binary name |
| `test_scripts/sanity-config.ts` | 2 | scripts | Config sanity check uses old tool name |
| `test_scripts/verify-ui-bridge.cjs` | 7 | scripts | IPC channel name verification |
| `tests/config.test.ts` | 8 | source code (tests) | Config path assertions |
| `tests/focused-input-helper.test.ts` | 4 | source code (tests) | Tool name in path assertions |
| `tests/index-ui.test.ts` | 2 | source code (tests) | References tool name |
| `tests/main.test.ts` | 4 | source code (tests) | References tool name |
| `tests/protocol-settings-store.test.ts` | 11 | source code (tests) | Path/constant assertions |
| `tests/protocol.test.ts` | 3 | source code (tests) | Log prefix assertions |
| `tests/turn-detector.test.ts` | 1 | source code (tests) | Log prefix assertion |
| `tests/ui-runtime-settings.test.ts` | 6 | source code (tests) | Path assertions |
| `tests/ui-settings-store.test.ts` | 14 | source code (tests) | Path/constant assertions |

**Special rename note:** `docs/tools/mic-tool-ts.md` must be **deleted/renamed** on disk to
`docs/tools/untype.md`. This is not merely a content update — the filename itself must change.

**IPC channel atomicity note:** `src/ui/electronMain.ts` and `src/ui/preload.cts` share the
`"mic-tool-ts:"` IPC channel prefix. Both files must be updated in the same edit pass — a mismatch
between the two causes a silent runtime breakage where IPC calls never resolve.

**Env-var prefix note:** `src/config.ts` uses `MIC_TOOL_TS_` as the env-var prefix for several
variables (e.g. `MIC_TOOL_TS_VERBOSE`). These env-var names appear in source, tests, and the
configuration guide. Requirement 7 covers them — they must become `UNTYPE_` (or `UNTYPE_VERBOSE`,
etc.) consistently across all touched files.

---

### Out-of-Scope (leave untouched — historical artifacts)

The following files pre-date this rename request and must NOT have their bodies rewritten.
They may continue to reference `mic-tool-ts` as historical records.

**docs/reference/ historical files (38 files):**
All `codebase-scan-*.md`, `investigation-*.md`, `refined-request-*.md`, `code-review-*.md`,
`dependency-validation-*.md`, `integration-verification-*.md`, `test-build-*.md` files under
`docs/reference/` except `refined-request-rename-to-untype.md` itself.

Representative list (not exhaustive — 38 files total):
- `docs/reference/codebase-scan-*.md` (9 files)
- `docs/reference/refined-request-*.md` (14 files, excluding the rename request itself)
- `docs/reference/investigation-*.md` (9 files)
- `docs/reference/code-review-phase-7.md`, `docs/reference/integration-verification-phase-10.md`, etc.

**docs/design/ historical plan and request files (36 files):**
All `plan-NNN-*.md`, `plan-NNN-*.html`, `request-NNN-*.md`, and `refined-request-*.md` files
under `docs/design/`:
- `docs/design/plan-001-soniox-mic-cli.md` through `plan-022-sidepanel-protocol-switches.md`
- `docs/design/request-006-elevenlabs-transcription-provider.md` through
  `request-017-ui-runtime-configuration-transcription.md`
- `docs/design/refined-request-soniox-mic-transcriber.md`
- `docs/design/focused-input-helper-design.md`
- `docs/design/plan-007-voice-agent-command-protocol.html`, etc.

Note: `docs/design/project-design.md`, `docs/design/project-functions.md`, and
`docs/design/configuration-guide.md` are **living documents** (not historical plans) and are
therefore **In-Scope** (listed above).

---

### New Integration Points (files that must be created)

| File | Action | Notes |
|---|---|---|
| `docs/tools/untype.md` | **Create** (by renaming `docs/tools/mic-tool-ts.md`) | New tool doc file; `<toolName>` root tag becomes `<untype>` |

No other new files need to be created by this rename. The `bin/` directory does NOT exist and no
wrapper script under `bin/` is needed (the `bin` field in `package.json` points directly to
`./dist/index.js`).

---

## 5. Notes

- **`MIC_TOOL_TS_` env-var prefix:** `src/config.ts` defines multiple env vars with the
  `MIC_TOOL_TS_` prefix. These propagate into test files, `README.md`, and `configuration-guide.md`.
  The rename spec (Requirement 7) covers them, but the implementer must systematically search for
  this prefix separately from searching for `mic-tool-ts` — a plain `sed` of `mic-tool-ts` →
  `untype` will NOT catch `MIC_TOOL_TS_` → `UNTYPE_` automatically.
- **No CI/CD workflow files:** No `.github/` directory exists. CI workflow updates are not
  required.
- **No `.env.example`, `.npmrc`, or `LICENSE` file:** These do not exist at the project root and
  require no action.
- **`vitest.config.*` absent:** No separate vitest config file exists; the test runner picks up
  config from `package.json`. Only `package.json` needs updating (already listed above).
- **`pnpm audit`:** Per the project's audit convention, `pnpm audit --audit-level=high` must be
  run after the rename build to confirm zero HIGH-or-above advisories. The rename introduces no
  new dependencies, so this is expected to pass without issue.
