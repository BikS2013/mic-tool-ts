# plan-005 — Project rename to `mic-tool-ts`

## Objective

Rename the project identity to `mic-tool-ts` and keep runtime behavior, documentation, tests, and local agent instructions consistent.

## Scope

- Package name: `package.json` `name`.
- Installed command: `package.json` `bin` and Commander help name.
- Per-user configuration folder: `~/.tool-agents/mic-tool-ts/.env`.
- Project-specific env-var namespace: `MIC_TOOL_TS_*`.
- Diagnostic prefix: `[mic-tool-ts]`.
- User-facing docs, design docs, tests, and sanity scripts.
- Local `CLAUDE.md` and project `AGENTS.md` notes that the tool must be invoked as a direct OS command.

## Requirements

- `mic-tool-ts --help` and `mic-tool-ts --version` must be the documented command examples.
- `resolveConfig()` must call `loadEnvChain({ toolName: "mic-tool-ts" })`.
- The old per-user config folder name must not remain in docs or source.
- Provider-canonical env vars must retain their existing names: `SONIOX_*` and `AZURE_OPENAI_*`.
- No compatibility fallback to the legacy project-specific env-var prefix or legacy per-user config folder is added.

## Acceptance Criteria

- Static search finds no standalone old command/config references.
- TypeScript typecheck passes.
- The test suite passes.
- `pnpm audit --audit-level=high` remains clean.

## Implementation Notes

- This rename is intentionally breaking for local shell aliases and per-user config paths. Users should move or recreate secrets under `~/.tool-agents/mic-tool-ts/.env`.
- Development commands such as `pnpm run dev` remain available for contributors, but installed/user-facing invocation is the direct OS command `mic-tool-ts`.


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
