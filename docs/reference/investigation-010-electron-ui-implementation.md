# Investigation 010: Electron UI Implementation

Access date: 2026-05-16

## Scope

Verify the Electron dependency choice immediately before implementing `mic-tool-ts ui`, then record the implementation constraints used for the Plan 009 UI pass.

## Sources

- npm package page for Electron: https://www.npmjs.com/package/electron
- Electron stable release feed: https://releases.electronjs.org/releases/stable
- GitHub Advisory Database search: https://github.com/advisories
- GitLab advisory listing for npm Electron: https://advisories.gitlab.com/pkg/npm/electron/

## Key Findings

- `npm view electron version` reported `42.1.0`.
- `npm view electron dist-tags --json` reported `latest: 42.1.0` and `42-x-y: 42.1.0`.
- The Electron stable release feed listed `42.1.0` as the current stable release line with Chromium `148.0.7778.97` and Node.js `24.15.0`.
- Advisory search did not surface an unfixed HIGH-or-above advisory for `electron@42.1.0`.
- `pnpm audit --audit-level=high` after installation reported no known vulnerabilities for the resolved dependency tree.

## Implementation Decisions

- Pin Electron as a runtime dependency using `"electron": "^42.1.0"`.
- Launch the UI through the installed direct command `mic-tool-ts ui`; do not document package-manager or `node dist/index.js` launch paths as user-facing invocations.
- Keep Electron renderer content local and packaged under `dist/ui/renderer/`.
- Use `BrowserWindow` with macOS titlebar integration, vibrancy, `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, and a preload bridge that exposes only `loadSettings`, `startSession`, `stopSession`, and `onSessionEvent`.
- Reuse the shared transcription session runner so CLI and UI mode share config validation, protocol behavior, mic/STT lifecycle, shutdown, and persistence.


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
