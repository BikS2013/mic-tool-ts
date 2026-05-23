# Refined Request: Rename Project from `mic-tool-ts` to `untype`

## Category
Configuration / Refactoring (cross-cutting rename across code, manifests, docs, and per-user config conventions)

## Objective
Perform a complete, hard rename of this TypeScript CLI project's user-facing identity from `mic-tool-ts` to `untype`. Every user-facing reference to the old name — the binary on `PATH`, the npm package name, the per-user configuration folder under `~/.tool-agents/`, the tool documentation file, the project's `CLAUDE.md` sections, and all in-code/in-docs string references — must be updated to `untype`. The tool's functional behavior (microphone capture, Soniox streaming, guard-phrase turn detection, optional LLM refinement) is unchanged; this is purely an identity rename.

## Scope

### In scope
- `package.json` `name` field and `bin` mapping.
- All TypeScript/JavaScript source files under `src/` (and any other source roots) where the string `mic-tool-ts` appears in user-facing output, log messages, error messages, config-path resolution, or runtime identifiers.
- Per-user configuration folder convention: the CLI must read from `~/.tool-agents/untype/` (with `~/.tool-agents/untype/.env` as the secrets file) instead of `~/.tool-agents/mic-tool-ts/`.
- Build/scaffolding scripts under `scripts/` that reference the old name.
- Configuration files (`tsconfig.json`, `vitest.config.*`, `.npmrc`, etc.) where the name appears.
- Tool documentation file: rename `docs/tools/mic-tool-ts.md` to `docs/tools/untype.md` and update its content (including the `<toolName>` XML block name, if any) to `untype`.
- The project's own `CLAUDE.md` — specifically the "Project Tool Invocation" and "Tools" sections — must reflect the new binary name, new config folder path, and the new documentation file path.
- Any prompts under `prompts/` that reference the old name.
- A migration note for end users must be added to `Issues - Pending Items.md` describing how to move their existing `~/.tool-agents/mic-tool-ts/.env` to `~/.tool-agents/untype/.env`.
- README and any other top-level human-facing documents at the project root.

### Out of scope
- Renaming the repository folder itself (`/Users/giorgosmarinos/aiwork/coding-platform/mic-tool-ts/`). The folder rename is a separate filesystem/git operation the user will execute later.
- Any git history rewrite, branch rename, remote URL change, or tag rename.
- Providing a backwards-compatible alias binary named `mic-tool-ts` on `PATH` — this is a hard rename, no alias.
- Automatic migration of the user's existing `~/.tool-agents/mic-tool-ts/` folder. The user migrates manually; the CLI only emits a clear error with a one-line hint when the old folder exists and the new one does not.
- Functional changes to mic capture, transcription, turn detection, LLM refinement, UI, or overlay behavior.
- Rewriting historical artifacts (existing `docs/design/plan-NNN-*.md` files and existing `docs/reference/refined-request-*.md` files that pre-date this rename). They remain as-is and continue to reference the old name where applicable. See Open Questions for an optional footer treatment.

## Requirements

1. **Package manifest rename.** In `package.json`:
   - `name` must be `"untype"`.
   - `bin` must map the key `"untype"` to the compiled entry script (currently `./dist/index.js`).
   - The `description` field, if it mentions the old name, must be updated.
   - The `version` field is not touched by this rename (versioning policy is out of scope for this request).

2. **Binary name on PATH.** After `pnpm install` / `pnpm link --global` (or equivalent), the user-facing OS command must be `untype`. The command `mic-tool-ts` must NO LONGER exist as a published binary from this package.

3. **Per-user config folder convention.** The CLI must resolve its per-user config folder to `~/.tool-agents/untype/` and its secrets file to `~/.tool-agents/untype/.env`. All source-level constants, helpers, and documentation that compute or reference this path must use `untype`.

4. **Old-folder detection error.** If at startup the resolved new folder `~/.tool-agents/untype/` does NOT exist but the legacy folder `~/.tool-agents/mic-tool-ts/` DOES exist, the CLI must raise a clear, actionable error that:
   - States the new expected path (`~/.tool-agents/untype/`).
   - Includes a one-line migration hint such as `mv ~/.tool-agents/mic-tool-ts ~/.tool-agents/untype`.
   - Does NOT silently fall back to reading the old folder (consistent with the project's no-fallback rule for configuration).

5. **Tool documentation rename.** The file `docs/tools/mic-tool-ts.md` must be renamed to `docs/tools/untype.md`. Inside, the `<toolName>` XML root tag (or equivalent) and all body references to `mic-tool-ts` must be replaced with `untype`. Examples in the `<command>` and `<info>` sections must use the new binary name.

6. **Project `CLAUDE.md` update.** The "Project Tool Invocation" section must:
   - State the tool name as `untype`.
   - State the supported invocation as the direct OS command `untype` on `PATH`.
   - State the per-user config folder as `~/.tool-agents/untype/` and the secrets file as `~/.tool-agents/untype/.env`.
   The "Tools" section entry currently listing `mic-tool-ts` must be replaced with an `untype` entry pointing to `docs/tools/untype.md`.

7. **Full code/doc string sweep.** Every occurrence of the literal string `mic-tool-ts` outside of historical-artifact files (see requirement 9) must be replaced with `untype`. This includes:
   - Source files (`src/**/*.ts`, `src/**/*.tsx`, `src/**/*.js`, `src/**/*.html`, `src/**/*.css`).
   - Build / helper scripts (`scripts/**`).
   - Test files (`test_scripts/**` if any reference the old name).
   - Prompts (`prompts/**`).
   - Top-level human-facing docs (`README.md`, `Issues - Pending Items.md` for new content, etc.).
   - Any `.env.example`, `.npmrc`, `LICENSE` header, or similar metadata files.

8. **End-user migration note in `Issues - Pending Items.md`.** A new top-level item must be added (under the pending items section, near the top because it affects all existing end users) that:
   - Announces the rename from `mic-tool-ts` to `untype`.
   - Tells end users to run `mv ~/.tool-agents/mic-tool-ts ~/.tool-agents/untype` to preserve their existing configuration and secrets.
   - Tells end users to uninstall any previously linked `mic-tool-ts` binary before linking `untype` (e.g. `pnpm unlink --global mic-tool-ts && pnpm link --global` from the project root after build).

9. **Historical artifacts left intact.** Files under `docs/design/plan-NNN-*.md` and `docs/reference/refined-request-*.md` that pre-date this rename must NOT have their bodies rewritten. They are historical records and may continue to reference `mic-tool-ts`. This refined-request file itself (`refined-request-rename-to-untype.md`) and the plan it spawns are the only documents in those folders that should contain occurrences of both names (because they describe the rename).

10. **Functional behavior preserved.** No code path that controls mic capture, Soniox streaming, guard-phrase turn detection, LLM refinement, Electron UI, overlay rendering, or hotkey handling may be altered semantically. Only identifiers/strings tied to the project's name change.

## Constraints

- **Language / runtime:** TypeScript, Node `>=20.12`, ESM (`"type": "module"`), per current `package.json`.
- **Package manager:** `pnpm` (per current scripts and the project's audit command `pnpm audit --audit-level=high`).
- **No fallback configuration:** Per project convention, the CLI must NOT silently fall back to reading from `~/.tool-agents/mic-tool-ts/` if `~/.tool-agents/untype/` is missing. It must raise an explicit, actionable error.
- **No new dependencies:** This rename must not introduce any new runtime or dev dependency. If any dependency-vetting work surfaces, document it separately.
- **No git operations:** Do not perform `git mv`, branch rename, remote URL change, or tag operations. File renames are filesystem-level only and will be committed by the user when they choose.
- **Tool-creation convention:** Renaming the existing tool's doc file (`docs/tools/mic-tool-ts.md` → `docs/tools/untype.md`) is a rename of an existing artifact, NOT a new-tool scaffold. The `/tool-conventions scaffold` slash command is NOT required for this rename. Conformance with the tool documentation format may be re-checked afterwards via `/tool-conventions audit untype` if desired.
- **Repository folder is NOT renamed in this request** — paths in this specification continue to use `/Users/giorgosmarinos/aiwork/coding-platform/mic-tool-ts/` as the project root.

## Acceptance Criteria

1. `package.json` `name` equals `"untype"` and `bin` contains a key `"untype"` mapping to the entry script. The previous key `"mic-tool-ts"` is removed.
2. Running `pnpm run build` succeeds and produces a binary that, when installed/linked, exposes the OS command `untype` on `PATH`. Running `mic-tool-ts` from a fresh shell after the rename returns "command not found" (no alias was created).
3. All source files under `src/` that previously embedded the string `mic-tool-ts` (in log lines, error messages, runtime identifiers, config-path helpers, UI window titles, Electron app `name`/`productName`, etc.) now embed `untype` instead.
4. With `~/.tool-agents/untype/.env` present and `~/.tool-agents/mic-tool-ts/` absent, the CLI loads its config from the new location and starts normally.
5. With `~/.tool-agents/untype/` absent and `~/.tool-agents/mic-tool-ts/` present, the CLI exits with a non-zero status and prints a clear error stating the new expected path plus the one-line migration hint `mv ~/.tool-agents/mic-tool-ts ~/.tool-agents/untype`.
6. The file `docs/tools/mic-tool-ts.md` no longer exists; the file `docs/tools/untype.md` exists, its `<toolName>` root tag is `<untype>`, and its `<command>` / `<info>` content uses `untype` everywhere.
7. The project's `CLAUDE.md` (`/Users/giorgosmarinos/aiwork/coding-platform/mic-tool-ts/CLAUDE.md`):
   - "Project Tool Invocation" section names the tool `untype`, the binary `untype`, the config folder `~/.tool-agents/untype/`, and the secrets file `~/.tool-agents/untype/.env`.
   - "Tools" section's entry references `untype` and points to `docs/tools/untype.md`. No entry references `mic-tool-ts`.
8. `Issues - Pending Items.md` contains, near the top of its pending items, a migration note for end users describing the folder move and the binary re-link steps.
9. Running `grep -r "mic-tool-ts" /Users/giorgosmarinos/aiwork/coding-platform/mic-tool-ts/ --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git` produces matches ONLY in:
   - `docs/design/plan-*.md` files that pre-date this rename (historical plans).
   - `docs/reference/refined-request-*.md` files that pre-date this rename (historical refined requests).
   - This refined-request file itself (`docs/reference/refined-request-rename-to-untype.md`) and the plan file that implements it.
   - The migration note inside `Issues - Pending Items.md` (which must reference the old name to be useful).
   Every other occurrence must have been replaced with `untype`.
10. `pnpm run typecheck` and `pnpm test` pass after the rename with zero new failures versus the pre-rename baseline.
11. `pnpm audit --audit-level=high` reports zero HIGH-or-above advisories (no regression vs. pre-rename baseline).
12. The tool's functional smoke test (start the CLI, capture a short utterance via Soniox, observe a transcript) behaves identically to the pre-rename behavior.

## Assumptions

- **Pre-existing entry script:** The compiled entry is `./dist/index.js` (from `package.json` `bin`). The TypeScript entry is `src/index.ts`. No separate `bin/mic-tool-ts.js` wrapper file currently exists (confirmed by directory inspection: `bin/` folder not present at the project root). The rename therefore only needs to update the `bin` *key* in `package.json`, not rename a file inside `bin/`. See Open Questions if a wrapper script is added later.
- **Electron `productName` / `name`:** If the Electron app's `name` or `productName` (in `package.json` or in code) is currently `mic-tool-ts`, it must be updated to `untype`. This is treated as a "user-facing runtime identifier" under Requirement 7.
- **The user accepts a one-time manual migration step.** End users with an existing `~/.tool-agents/mic-tool-ts/` folder will move it manually to `~/.tool-agents/untype/`; no automated copy is performed by the CLI.
- **README and similar root docs exist or may exist.** If a `README.md` references the old name, it is updated. If no such file exists, no new file is created by this rename.
- **The user has no published-to-npm artifact under the old name to deprecate.** The package has not been published (or, if it has, deprecation/redirect on npm is out of scope of this local rename). If npm publishing is in fact in play, it should be addressed in a follow-up request.
- **No CI/CD pipeline references the binary by name.** If a CI workflow file (e.g. `.github/workflows/*.yml`) references `mic-tool-ts`, it falls under Requirement 7 and must be updated; this assumption merely flags that the rename does not need to coordinate with an external deployment system.

## Open Questions

1. **Wrapper script under `bin/`.** No `bin/mic-tool-ts.js` file currently exists in the repository. If during implementation a wrapper script is introduced under a `bin/` directory, should it be named `bin/untype.js` and referenced from `package.json`'s `bin` field? (Default during execution: yes, name it `bin/untype.js` to keep the on-disk filename aligned with the binary name. Confirm before adding such a file.)
2. **Historical-artifact footer.** Should each pre-existing `docs/design/plan-NNN-*.md` and `docs/reference/refined-request-*.md` file that references `mic-tool-ts` receive a one-line footer such as `> Note: the project was renamed from "mic-tool-ts" to "untype" on 2026-05-23. References to "mic-tool-ts" in this document are preserved for historical accuracy.`? Per the current scope, these files are left untouched. The user has not yet decided whether the footer note is desired.

## Original Request

> Change the name of the app from `mic-tool-ts` to `untype`.
>
> Decisions already confirmed with the user via AskUserQuestion — bake these into Requirements/Scope/Acceptance Criteria, do NOT re-ask:
>
> 1. Binary name on PATH: `untype` (hard rename, no alias for the old `mic-tool-ts` binary).
> 2. Per-user config folder: rename `~/.tool-agents/mic-tool-ts/` → `~/.tool-agents/untype/` (hard rename; user migrates manually; document the migration step in the spec).
> 3. npm package name in `package.json`: rename to `untype`.
> 4. Scope of references: full rebrand — code, package manifests, configs, docs (including `docs/tools/mic-tool-ts.md` → `docs/tools/untype.md`), the project's own `CLAUDE.md`, prompts, scripts, and any references inside historical plans/refined-request files in `docs/`.
>
> Additional context the spec must capture:
> - The project is a TypeScript CLI located at `/Users/giorgosmarinos/aiwork/coding-platform/mic-tool-ts/`.
> - The repo folder itself (`mic-tool-ts/`) is NOT being renamed in this request (out of scope — folder rename is a separate git/filesystem operation the user can do later).
> - The git history, branch names, and remote URL are out of scope.
> - The tool's functional behavior (mic capture, Soniox streaming, guard-phrase detection, LLM refinement) does NOT change — this is purely a rename.
>
> Make sure the Acceptance Criteria includes:
> - `package.json` `name` field is `untype` and `bin` maps `untype` to the entry script.
> - All source files reference the new name where the name is user-facing or affects runtime paths.
> - The CLI's resolved config path is `~/.tool-agents/untype/.env` and the tool errors out clearly if only the old folder exists (with a one-line migration hint).
> - `docs/tools/mic-tool-ts.md` is renamed to `docs/tools/untype.md` and its content updated.
> - The project's `CLAUDE.md` "Project Tool Invocation" and "Tools" sections reflect the new name.
> - A migration note is added to `Issues - Pending Items.md` for end users.
> - `grep -r "mic-tool-ts"` after the rename returns ONLY historical references inside `docs/design/plan-*.md` and `docs/reference/refined-request-*.md` files that pre-date this rename — every other occurrence must be the new name.
>
> Open Questions to surface (do NOT decide unilaterally):
> - Should the binary entry script filename (e.g. `bin/mic-tool-ts.js` if it exists) also be renamed on disk?
> - Should historical artifacts under `docs/design/` and `docs/reference/` (existing plan-NNN files, prior refined-request files) be left untouched, or should they get a "renamed to untype on 2026-05-23" footer?
