---
status: clean
mode: fix
package_manager: pnpm@10.33.2
ecosystem: node
iterations_run: 1
deprecations_initial: 0
deprecations_final: 0
vulnerabilities_initial: 0
vulnerabilities_final: 0
target_path: /Users/giorgosmarinos/aiwork/coding-platform/mic-tool-ts
validated_at: 2026-05-16T00:00:00Z
last_validated_commit: null
---

# Dependency Validation — mic-tool-ts (Soniox Mic CLI)

## 1. Summary

The mic-tool-ts project uses pnpm@10.33.2 as its package manager with a lockfile at format version 9.0. After running `pnpm install`, `pnpm outdated`, and `pnpm audit` across all 290 resolved packages (109 production, 181 dev/optional), zero deprecation warnings were emitted by the install step, zero deprecated packages were found in the registry for any direct dependency, and zero security advisories were found at any severity level. The project's dependency tree is clean. No replacements were applied and no iterations beyond the initial scan were required.

## 2. Initial State

### Direct Dependencies

| Package | Current | Latest | Wanted | Scope | Deprecated | Severity | Notes |
|---|---|---|---|---|---|---|---|
| `@soniox/node` | 2.0.3 | 2.0.3 | 2.0.3 | direct (prod) | No | — | At latest stable |
| `commander` | 14.0.3 | 14.0.3 | 14.0.3 | direct (prod) | No | — | At latest stable |
| `@types/node` | 20.19.41 | 25.8.0 | 20.19.41 | direct (dev) | No | — | Outdated (not deprecated); caret range `^20.19.0` intentionally pins to Node 20 LTS type surface |
| `tsx` | 4.22.0 | 4.22.0 | 4.22.0 | direct (dev) | No | — | At latest stable |
| `typescript` | 6.0.3 | 6.0.3 | 6.0.3 | direct (dev) | No | — | At latest stable |
| `vitest` | 4.1.6 | 4.1.6 | 4.1.6 | direct (dev) | No | — | At latest stable |

### Deprecation Warnings from Install

None. The `pnpm install` output contained no `warn deprecated` lines. The only advisory message was an informational note that `esbuild@0.28.0`'s build scripts are blocked by pnpm's default script-approval policy (`Ignored build scripts: esbuild@0.28.0`). This is a security-by-default pnpm feature, not a deprecation.

### Transitive Tree Summary

290 total packages resolved. Key transitive packages spot-checked for deprecation:

| Package | Version | Deprecated | Notes |
|---|---|---|---|
| `esbuild` | 0.28.0 | No | Current; build scripts blocked by pnpm policy (expected) |
| `vite` | 8.0.13 | No | Current |
| `rolldown` | 1.0.1 | No | Current |
| `postcss` | 8.5.14 | No | Current |
| `nanoid` | 3.3.12 | No | Current |
| `undici-types` | 6.21.0 | No | Current |
| `lightningcss` | 1.32.0 | No | Current |
| `fsevents` | 2.3.3 | No | Current macOS-native watcher |

## 3. Replacements Applied

None. The dependency tree was clean on the first scan. No replacements were planned or executed.

## 4. Manual Review Needed

### Outdated (not deprecated): `@types/node`

- **Package**: `@types/node@20.19.41`
- **Latest on registry**: `25.8.0`
- **Why not auto-fixed**: The version range `^20.19.0` in `devDependencies` is intentional — it matches the project's declared Node.js engine requirement (`>=20.12` in `package.json`). Bumping to `@types/node@^25` would introduce type surface for Node 25 APIs that do not exist on Node 20 LTS, potentially causing type errors. This is a **deliberate constraint**, not a hygiene gap.
- **Recommended next step**: When the project's minimum supported Node version is raised to 22 LTS or 24+, update both `engines.node` in `package.json` and `@types/node` in lock-step.

### Informational: esbuild build-script approval

- **Package**: `esbuild@0.28.0` (transitive, pulled by `tsx@4.22.0`)
- **Why noted**: pnpm 10's default `onlyBuiltDependencies` policy blocks `esbuild`'s install-time binary download script. The package was already installed correctly (binary present from a prior `pnpm approve-builds` or explicit allow), so functionality is unaffected.
- **Recommended next step**: If building on a fresh CI machine and `esbuild` fails to find its binary, run `pnpm approve-builds` once, or add `esbuild` to the `pnpm.allowedBuildScripts` list in `package.json`. This is not a security issue.

## 5. Security Audit

Audit run: `pnpm audit --json` (pnpm@10.33.2, lockfile v9.0)

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Moderate | 0 |
| Low | 0 |
| Info | 0 |
| **Total** | **0** |

Total packages scanned: 109 (production) across 290 resolved nodes. No advisories found. Zero actions recommended by the audit.

A second pass at `--audit-level=low` confirmed the same zero-advisory result.

## 6. Final State

The project's dependency tree is **clean**:

- Zero deprecated packages (direct or transitive).
- Zero security advisories at any severity level.
- All direct dependencies are at their latest stable version except `@types/node`, which is intentionally pinned to the Node 20 LTS type surface and is not deprecated.
- The single `pnpm outdated` finding (`@types/node`: current 20.19.41, latest 25.8.0) is a planned constraint, not a defect.
- No manifest changes were made.
- No source-code import changes were made.

**Status: `clean`**

## 7. Commands Run

| # | Command | Exit Code | Notes |
|---|---|---|---|
| 1 | `pnpm install` | 0 | Lockfile up to date; no packages downloaded. Informational note about `esbuild` build scripts. |
| 2 | `pnpm outdated --format json` | 1 | Exit 1 is normal when outdated packages exist; JSON parsed successfully. One outdated package found: `@types/node`. |
| 3 | `pnpm audit --json` | 0 | Zero vulnerabilities across 109 production dependencies. |
| 4 | `pnpm audit --audit-level=info` | 0 | Confirmed: "No known vulnerabilities found." |
| 5 | `pnpm audit --audit-level=low --json` | 0 | Confirmed zero across all severity levels. |
| 6 | `pnpm list --depth=10` | 0 | Full tree enumerated (290 packages); used to identify key transitive deps for spot-check. |
| 7 | `npm view @soniox/node@2.0.3 deprecated` | — | No output (not deprecated). |
| 8 | `npm view commander@14.0.3 deprecated` | — | No output (not deprecated). |
| 9 | `npm view tsx@4.22.0 deprecated` | — | No output (not deprecated). |
| 10 | `npm view typescript@6.0.3 deprecated` | — | No output (not deprecated). |
| 11 | `npm view vitest@4.1.6 deprecated` | — | No output (not deprecated). |
| 12 | `npm view @types/node@20.19.41 deprecated` | — | No output (not deprecated). |
| 13 | `npm view esbuild@0.28.0 deprecated` | — | No output (not deprecated). |
| 14 | `npm view vite@8.0.13 deprecated` | — | No output (not deprecated). |
| 15 | `npm view rolldown@1.0.1 deprecated` | — | No output (not deprecated). |
| 16 | `npm view @soniox/node dist-tags` | — | Confirmed latest: 2.0.3 (installed version is current). |


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
