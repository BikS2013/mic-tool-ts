# Plan 024 — Rename project from `mic-tool-ts` to `untype`

## Provenance
- **REFINED_REQUEST_FILE:** `docs/reference/refined-request-rename-to-untype.md`
- **CODEBASE_SCAN_FILE:** `docs/reference/codebase-scan-rename-to-untype.md`
- **INVESTIGATION_FILE:** _(skipped — single mechanical rename, no design choice to evaluate)_
- **TECHNICAL_RESEARCH_FILES:** _(none)_

## Decisions confirmed with user
1. Binary name: hard rename to `untype` (no `mic-tool-ts` alias).
2. Per-user config folder: hard rename `~/.tool-agents/mic-tool-ts/` → `~/.tool-agents/untype/`. User migrates manually; CLI emits a clear error with migration hint when only the old folder exists.
3. npm `name` field: `untype`.
4. Scope: full rebrand across code, manifests, configs, docs, prompts, scripts, `CLAUDE.md`.
5. Historical artifacts under `docs/design/plan-*.md`, `docs/design/request-*.md`, `docs/design/refined-request-*.md`, and `docs/reference/(codebase-scan|investigation|refined-request|code-review|dependency-validation|integration-verification|test-build)-*.md` get a one-line rename footer; bodies otherwise untouched.
6. Env-var prefix: `MIC_TOOL_TS_*` → `UNTYPE_*`; migration note enumerates each variable.

## Out of scope
- Renaming the repo folder on disk (`mic-tool-ts/`).
- Any git operation (mv, branch rename, remote URL change, tags).
- Automatic copy/move of the user's existing `~/.tool-agents/mic-tool-ts/` folder.
- Functional behavior changes (mic capture, Soniox/ElevenLabs streaming, turn detection, LLM refinement, Electron UI).

## Execution order

### Phase A — Identifier strings (semantic care)
1. **`src/config.ts`** — `toolName` constant, every `MIC_TOOL_TS_` env-var name, `~/.tool-agents/mic-tool-ts/` path. Add the old-folder detection error: when `~/.tool-agents/untype/` does not exist but `~/.tool-agents/mic-tool-ts/` does, throw `ConfigError` with the message `Config folder not found at ~/.tool-agents/untype/. Detected legacy folder at ~/.tool-agents/mic-tool-ts/. Migrate with: mv ~/.tool-agents/mic-tool-ts ~/.tool-agents/untype`. No silent fallback.
2. **`src/config/envChain.ts`** — `toolName` literal.
3. **`src/ui/electronMain.ts` + `src/ui/preload.cts`** — IPC channel prefix `"mic-tool-ts:"` → `"untype:"`. MUST be updated in a single atomic edit pass to keep both ends matching. Also update `loadEnvChain({ toolName: ... })` and window title.
4. **All other `src/**` files** — log-message prefixes `[mic-tool-ts]` → `[untype]`, error-message strings, HTML title strings, runtime identifiers.
5. **`native/macos/input-helper/main.swift`** — single occurrence (helper identifier or log line).
6. **`scripts/build-native-helper.mjs`** — 5 occurrences.

### Phase B — Tests
7. **`tests/*.test.ts`** — update path assertions (`~/.tool-agents/untype/...`), log-prefix assertions, env-var name assertions, IPC channel assertions.
8. **`test_scripts/*`** — same updates plus binary-name updates in `focused-input-helper-smoke.sh` and `verify-ui-bridge.cjs`.

### Phase C — Manifests and project root
9. **`package.json`** — `name`: `untype`; `bin`: `{ "untype": "./dist/index.js" }`; update `description` if it mentions the old name.
10. **`README.md`** — full sweep (41 occurrences).
11. **`CLAUDE.md`** — "Project Tool Invocation" and "Tools" sections.
12. **`AGENTS.md`** — 4 occurrences.

### Phase D — Living docs (under `docs/design/`)
13. **`docs/design/project-design.md`** — 51 occurrences.
14. **`docs/design/project-functions.md`** — 13 occurrences.
15. **`docs/design/configuration-guide.md`** — 35 occurrences. Update the configuration guide so `MIC_TOOL_TS_*` env-var names are replaced with `UNTYPE_*` and the resolved config folder is `~/.tool-agents/untype/`.

### Phase E — Tool documentation
16. **Rename `docs/tools/mic-tool-ts.md` → `docs/tools/untype.md`** and rewrite content: `<toolName>` root tag → `<untype>`, all `<command>` / `<info>` references → `untype`, config folder paths → `~/.tool-agents/untype/`, env-var names → `UNTYPE_*`.

### Phase F — Issues log + migration note
17. **`Issues - Pending Items.md`** — Update existing references to the old name. Add a new pending item at the top of the pending section titled "Migration from `mic-tool-ts` to `untype`" containing:
    - The folder move: `mv ~/.tool-agents/mic-tool-ts ~/.tool-agents/untype`.
    - The binary re-link: `pnpm unlink --global mic-tool-ts && pnpm link --global` (from the project root after `pnpm run build`).
    - The env-var rename table (`MIC_TOOL_TS_<NAME>` → `UNTYPE_<NAME>`) with one row per variable defined in `src/config.ts`.

### Phase G — Historical-artifact footers
18. For each pre-existing file under:
    - `docs/design/plan-*.md` (23 files), `docs/design/plan-*.html` (3 files)
    - `docs/design/request-*.md` (12 files)
    - `docs/design/refined-request-*.md` (excluding none — only `refined-request-soniox-mic-transcriber.md` exists in this folder)
    - `docs/design/focused-input-helper-design.md`
    - `docs/reference/codebase-scan-*.md` (except `codebase-scan-rename-to-untype.md`)
    - `docs/reference/investigation-*.md`
    - `docs/reference/refined-request-*.md` (except `refined-request-rename-to-untype.md`)
    - `docs/reference/code-review-*.md`, `dependency-validation-*.md`, `integration-verification-*.md`, `test-build-*.md`
    Append exactly this footer (separated from existing content by a blank line):
    ```
    
    ---
    > **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
    ```
    Do NOT rewrite the file body.

### Phase H — Verification
19. Run `pnpm install` (no new deps, but refreshes lockfile if any rename touched it).
20. Run `pnpm run typecheck` — must pass.
21. Run `pnpm test` — must pass with zero new failures vs. baseline.
22. Run `pnpm audit --audit-level=high` — must report zero HIGH-or-above advisories.
23. Run the post-condition grep:
    ```
    grep -rln "mic-tool-ts" /Users/giorgosmarinos/aiwork/coding-platform/mic-tool-ts/ \
      --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude-dir=out
    ```
    Expected matches ONLY in:
    - Historical artifacts under `docs/design/` and `docs/reference/` (each carrying the new footer).
    - `docs/reference/refined-request-rename-to-untype.md`, `docs/reference/codebase-scan-rename-to-untype.md`, `docs/design/plan-024-rename-to-untype.md` (this plan).
    - The migration note inside `Issues - Pending Items.md`.
    Same grep for `MIC_TOOL_TS_` — same allowed locations only.
24. Update `docs/design/project-design.md` provenance section to cite this plan, the refined-request file, and the scan file.

## Risk and mitigation
- **IPC channel mismatch** between `electronMain.ts` and `preload.cts` → silent UI breakage. Mitigation: edit both files in the same step and re-grep `"mic-tool-ts:"` to confirm zero remaining matches before moving on.
- **Env-var prefix sweep miss** → tests that assert `process.env.MIC_TOOL_TS_*` will fail. Mitigation: dedicated grep for `MIC_TOOL_TS_` after the main sweep.
- **Old-folder detection regression** → users with existing `~/.tool-agents/mic-tool-ts/` get a cryptic "config not found". Mitigation: explicit unit test in `tests/config.test.ts` that asserts the migration-hint error message when only the old folder exists.

## Acceptance checklist (mirrors refined request §Acceptance Criteria)
- [ ] `package.json.name === "untype"`, `package.json.bin.untype === "./dist/index.js"`, no `"mic-tool-ts"` key.
- [ ] `pnpm run build` succeeds.
- [ ] Source files updated (Phases A–B).
- [ ] CLI loads from `~/.tool-agents/untype/.env` when present.
- [ ] CLI errors out with migration hint when only legacy folder exists.
- [ ] `docs/tools/mic-tool-ts.md` removed; `docs/tools/untype.md` exists and is rewritten.
- [ ] `CLAUDE.md` Project Tool Invocation + Tools sections updated.
- [ ] Migration note added to `Issues - Pending Items.md`.
- [ ] Post-condition grep returns only the allowed historical/migration locations.
- [ ] `pnpm run typecheck`, `pnpm test`, `pnpm audit --audit-level=high` all clean.
