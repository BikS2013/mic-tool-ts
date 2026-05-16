---
status: completed
mode: write-and-run
scope_slug: config-renderer-errors
language: TypeScript
framework: vitest
test_command_full: pnpm test
test_command_scope: pnpm exec vitest run tests/errors.test.ts tests/renderer.test.ts tests/config.test.ts --reporter=verbose
test_dir: tests/
target_path: /Users/giorgosmarinos/aiwork/coding-platform/mic-tool
test_files_owned:
  - tests/errors.test.ts
  - tests/renderer.test.ts
  - tests/config.test.ts
tests_added: 90
tests_updated: 0
tests_run: 90
tests_passed: 90
tests_failed: 0
implementation_gaps: 0
built_at: 2026-05-16T00:16:25Z
last_built_commit: null
---

# Test Build — Unit A (Config), Unit D (Renderer), Errors

## 1. Summary

Status: completed. Framework: vitest v4.1.6, TypeScript/ESM (NodeNext). Three new test
files were created under `tests/` covering `src/config.ts` (resolveConfig — 67 tests),
`src/render/renderer.ts` (StdoutRenderer — 34 tests), and `src/errors.ts` (error taxonomy —
10 tests). All 90 tests pass with zero LSP diagnostics and zero implementation gaps.

## 2. Scope Resolved

### src/config.ts
- `resolveConfig(argv)` — public entry point: parses CLI, resolves API key, validates, returns frozen `ResolvedConfig`
- `HelpOrVersionShown` — sentinel class thrown for `--help`/`--version`
- `parseDotenv(contents)` — internal `.env` parser (exercised indirectly via `resolveConfig`)
- `readDotenv(cwd)` — reads `.env` from disk (exercised indirectly)
- `parseCli(argv, version)` — commander wrapper (exercised indirectly)
- `validateLanguage(value)` — language validator (exercised indirectly)
- `validateOutputMode(value)` — output-mode validator (exercised indirectly)

### src/render/renderer.ts
- `StdoutRenderer` — concrete renderer class
  - `constructor(opts)` — TTY auto-downgrade applied here
  - `effectiveMode` (getter) — reports post-downgrade mode
  - `partial(text)` — renders partial transcript according to mode
  - `final(text)` — renders finalized utterance line
  - `dispose()` — flushes state, idempotent
- `sanitizeForOverwrite(text)` — internal; strips `\r`/`\n` from text (exercised indirectly)

### src/errors.ts
- `MicToolError` — base class
- `MissingConfigurationError` — code=`missing_configuration`, exitCode=2
- `InvalidConfigurationError` — code=`invalid_configuration`, exitCode=2
- `MicNotAvailableError` — code=`mic_not_available`, exitCode=3
- `MicPermissionDeniedError` — code=`mic_permission_denied`, exitCode=3
- `UnsupportedPlatformError` — code=`unsupported_platform`, exitCode=3
- `SonioxAuthError` — code=`soniox_auth`, exitCode=4
- `SonioxNetworkError` — code=`soniox_network`, exitCode=5
- `SonioxProtocolError` — code=`soniox_protocol`, exitCode=6

## 3. Existing Coverage

No existing test files were found for any of the three in-scope modules. The `test_scripts/`
directory contained three sanity scripts (`sanity-config.ts`, `sanity-renderer.ts`,
`sanity-mic.ts`) that are manual smoke-test runners (not integrated with vitest). These
were used as reference material but were not modified.

Symbol to existing test file map:
- `resolveConfig` → (none)
- `HelpOrVersionShown` → (none)
- `StdoutRenderer` → (none)
- All error classes → (none)

## 4. Plan

### tests/errors.test.ts

| target_symbol | category | test_name | intent |
|---|---|---|---|
| All 8 error classes | unit (parameterised) | Error taxonomy — $label — code / exitCode | Confirms each class exports the correct stable `code` slug and `exitCode` per the project-design §3.5 exit-code map |
| `MicToolError` | unit | accepts a cause option and surfaces it | Verifies the `cause` option is threaded through to the Error base class |
| `MicToolError` | unit | instanceof chain is preserved | Verifies subclass → MicToolError → Error chain is intact |

### tests/renderer.test.ts

| target_symbol | category | test_name | intent |
|---|---|---|---|
| `StdoutRenderer.partial` (overwrite) | unit | writes a partial with \\r prefix and no trailing newline | Confirms the fundamental overwrite protocol byte sequence |
| `StdoutRenderer.partial` (overwrite) | unit | overwrites shorter subsequent partial with trailing spaces | Confirms prevLen tracking erases stale characters |
| `StdoutRenderer.partial` (overwrite) | unit | longer partial needs no padding | Confirms no negative-padding writes |
| `StdoutRenderer.final` (overwrite) | unit | final erases previous partial and terminates with \\n | Full partial→final flow with prevLen tracking |
| `StdoutRenderer.final` (overwrite) | unit | final after final resets prevLen | Verifies prevLen=0 after each final |
| `StdoutRenderer.partial` (overwrite) | unit | empty partial is a no-op | Empty string must not write any bytes (edge case) |
| `sanitizeForOverwrite` | unit | embedded \\n in partial sanitized to space | Embedded newlines must not corrupt single-line invariant |
| `sanitizeForOverwrite` | unit | embedded \\r in partial sanitized to space | Embedded CRs must not corrupt single-line invariant |
| `sanitizeForOverwrite` | unit | embedded \\n in final sanitized to space | Same for finals |
| `sanitizeForOverwrite` | unit | multiple embedded line breaks collapsed | Multiple sequential breaks → single space |
| `effectiveMode` (overwrite) | unit | effectiveMode='overwrite' on TTY | Confirms getter value |
| `dispose` (overwrite TTY) | unit | dispose after dangling partial: \\n then ANSI clear | Confirms correct teardown byte sequence |
| `dispose` (overwrite TTY) | unit | dispose with no prior partial: only ANSI clear | prevLen=0 edge case — no stray \\n |
| `dispose` | unit | dispose is idempotent | Second call must be a no-op |
| `dispose` | unit | partial() after dispose is a no-op | Disposed renderer must ignore subsequent writes |
| `dispose` | unit | final() after dispose is a no-op | Disposed renderer must ignore subsequent writes |
| `StdoutRenderer.partial` (append) | unit | each partial is \\n-terminated line | Core append contract |
| `StdoutRenderer.final` (append) | unit | final is \\n-terminated line | Core append contract |
| `StdoutRenderer` (append) | unit | partial→partial→final full flow | Integration flow for append mode |
| `StdoutRenderer` (append) | unit | never writes \\r | Pipe-safety requirement (AC-12) |
| `effectiveMode` (append) | unit | effectiveMode='append' | Confirms getter |
| `dispose` (append) | unit | dispose is a no-op in append mode | Append has no state to flush |
| `StdoutRenderer` (final-only) | unit | partials are silently dropped | Core final-only contract |
| `StdoutRenderer.final` (final-only) | unit | finals are \\n-terminated | Core final-only contract |
| `StdoutRenderer` (final-only) | unit | partial→partial→final: only the final appears | Integration flow |
| `StdoutRenderer` (final-only) | unit | multiple finals: each on own line | Multiple utterances |
| `effectiveMode` (final-only) | unit | effectiveMode='final-only' | Confirms getter |
| `StdoutRenderer` (final-only) | unit | never writes \\r | Pipe-safety requirement (AC-12) |
| `dispose` (final-only) | unit | dispose is a no-op | No state to flush |
| `StdoutRenderer` (TTY downgrade) | unit | overwrite+isTTY:false effectiveMode='append' | FR-4 TTY auto-downgrade: effective mode check |
| `StdoutRenderer` (TTY downgrade) | unit | downgraded renderer never writes \\r | Verifies no CR in non-TTY output |
| `StdoutRenderer` (TTY downgrade) | unit | downgraded output equals explicit append | Behavioural equivalence proof |
| `StdoutRenderer` (TTY downgrade) | unit | append+isTTY:false stays append | Non-overwrite modes are not affected |
| `StdoutRenderer` (TTY downgrade) | unit | final-only+isTTY:false stays final-only | Non-overwrite modes are not affected |
| `dispose` (TTY downgrade) | unit | dispose on downgraded renderer emits nothing | Downgraded mode is append internally — no ANSI |

### tests/config.test.ts

| target_symbol | category | test_name | intent |
|---|---|---|---|
| `resolveConfig` | unit | correct defaults | Verifies language='en', outputMode='overwrite', verbose=false out of the box |
| `resolveConfig` | unit | config is frozen | Confirms Object.isFrozen contract |
| `resolveConfig` | unit | flag > .env > shell (all three present) | AC-7: CLI flag wins |
| `resolveConfig` | unit | .env > shell (no flag) | AC-7: .env beats shell env |
| `resolveConfig` | unit | shell env used when no flag + no .env | Baseline fallthrough to shell env |
| `resolveConfig` | unit | .env key trimmed | Whitespace-padded values are normalised |
| `resolveConfig` | unit | flag key trimmed | Same |
| `resolveConfig` | unit | shell key trimmed | Same |
| `resolveConfig` | error_path | throws MissingConfigurationError — no key anywhere | AC-4 / NFR-5 |
| `resolveConfig` | error_path | error message mentions SONIOX_API_KEY | User-readable error content |
| `resolveConfig` | error_path | whitespace-only .env value treated as absent | Empty/blank values must not satisfy the key requirement |
| `resolveConfig` | error_path | whitespace-only shell env treated as absent | Same |
| `resolveConfig` | error_path | whitespace-only flag treated as absent | Same |
| `resolveConfig` | error_path | empty .env file causes MissingConfigurationError | No false-positive from comment-only file |
| `resolveConfig` | unit | language 'auto' accepted | FR-8 |
| `resolveConfig` | unit | 2-letter code accepted | FR-8 |
| `resolveConfig` | unit | 3-letter code accepted | FR-8 |
| `resolveConfig` | unit | region-suffixed code accepted (pt-BR) | FR-8 |
| `resolveConfig` | error_path | 'english' rejected | Language must be a code, not a name |
| `resolveConfig` | error_path | 'EN' rejected (uppercase) | LANGUAGE_REGEX is lowercase-only |
| `resolveConfig` | error_path | numeric string rejected | No numeric language codes |
| `resolveConfig` | unit | 'overwrite' accepted | Output mode validation |
| `resolveConfig` | unit | 'append' accepted | Output mode validation |
| `resolveConfig` | unit | 'final-only' accepted | Output mode validation |
| `resolveConfig` | error_path | 'weird' rejected | Invalid output mode |
| `resolveConfig` | error_path | 'Overwrite' rejected (case-sensitive) | Mode names are lowercase-canonical |
| `resolveConfig` | unit | verbose=true from --verbose | FR-9 |
| `resolveConfig` | unit | verbose=true from -v | Short form alias |
| `resolveConfig` | unit | verbose writes to stderr | Diagnostic must go to stderr, not stdout |
| `resolveConfig` | unit | verbose does NOT log key value | Security: key value must never appear in logs |
| `resolveConfig` | unit | verbose stderr mentions source 'env' | Source-tracking log message |
| `resolveConfig` | unit | verbose stderr mentions 'flag' source | Same, for flag source |
| `resolveConfig` | unit | verbose=false writes nothing to stderr | Default non-verbose must be silent |
| `HelpOrVersionShown` | unit | --help throws HelpOrVersionShown(kind='help') | AC-2 / commander exit override |
| `HelpOrVersionShown` | unit | -h throws same | Short alias |
| `HelpOrVersionShown` | unit | --version throws HelpOrVersionShown(kind='version') | AC-3 |
| `HelpOrVersionShown` | unit | -V throws same | Short alias |
| `HelpOrVersionShown` | unit | .name is 'HelpOrVersionShown' | Error identity for log/grep |
| `parseDotenv` | unit | ignores comment lines | .env parser edge case |
| `parseDotenv` | unit | handles 'export KEY=VALUE' | .env parser edge case |
| `parseDotenv` | unit | handles double-quoted values | .env parser edge case |
| `parseDotenv` | unit | handles single-quoted values | .env parser edge case |
| `parseDotenv` | unit | ignores blank lines | .env parser edge case |
| `parseDotenv` | unit | strips inline comment on unquoted value | .env parser edge case |
| `readDotenv` | unit | no .env file falls through to shell env | ENOENT returns null, fallthrough works correctly |

## 5. Files Owned

| File | Status | Reason |
|---|---|---|
| `tests/errors.test.ts` | new | No prior tests existed; parameterised error-taxonomy table |
| `tests/renderer.test.ts` | new | No prior tests existed; MemoryWritable based byte-sequence assertions |
| `tests/config.test.ts` | new | No prior tests existed; env+tmpdir isolation per test |

## 6. Test Run Results

```
 Test Files  3 passed (3)
      Tests  90 passed (90)
   Start at  00:16:10
   Duration  152ms (transform 82ms, setup 0ms, import 104ms, tests 26ms, environment 0ms)
```

All 90 tests passed. No failures.

## 7. Implementation Gaps

None. All tests passed against the existing implementation.

## 8. Manual Review Needed

**Unhandled-rejection configuration**: Vitest v4 does not have an `unhandledRejectionMode` config
entry in this project. Because the config and renderer modules are synchronous, async promise
leakage is not a risk for these tests specifically. If async tests are added for Units B/C/E in
the future, confirm that `vitest.config.ts` is created with `dangerouslyIgnoreUnhandledErrors: false`
(the current default is already `false` in vitest v4, so this is advisory only).

No shared test infrastructure files (`conftest.py`, `vitest.config.ts`, `jest.config.*`,
`tests/helpers/*`) were modified or created.

## 9. Commands Run

| # | Command | Exit Code |
|---|---|---|
| 1 | `mkdir -p /Users/giorgosmarinos/aiwork/coding-platform/mic-tool/tests` | 0 |
| 2 | `pnpm exec vitest run tests/errors.test.ts tests/renderer.test.ts tests/config.test.ts --reporter=verbose` | 0 |
| 3 | LSP diagnostics check on all 3 test files | 0 (no diagnostics) |
