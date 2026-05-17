# Refined Request: UI Runtime Configuration And Live Transcription

## Category
Development, configuration, defect resolution.

## Objective
Make the Electron UI a real operational surface for `mic-tool-ts`: it must load and display the resolved configuration state before a session starts, show live partial and final transcription events while listening, surface startup/configuration errors clearly, and drive the same runtime session used by the CLI.

## Scope
In scope:

- Load UI settings from the same configuration chain used by the CLI.
- Show active provider, model, languages, sample rate, endpoint detection, protocol mode, operator settings, LLM setting, API-key status, expiry, and credential source without exposing secret values.
- Preserve the no-fallback configuration rule: missing required configuration must be reported as an error, not replaced with fake values.
- Ensure `Start Listening` uses the loaded or edited UI settings to start the shared `runMicSession()` path.
- Ensure live `transcript.partial`, `transcript.final`, `transcript.refined`, diagnostics, protocol events, and lifecycle events update the renderer.
- Add focused automated coverage for the runtime setting conversion and initial config load behavior.
- Document the issue and solution in the project design, functional requirements, and pending/completed issue log.

Out of scope:

- Persisting arbitrary UI edits back into `.env` files.
- Adding new STT or LLM providers.
- Changing the spoken command protocol.
- End-to-end validation with real microphone audio and a production API key inside this automated pass.

## Requirements

- The Electron main process must resolve current configuration on UI load instead of returning hard-coded default renderer settings.
- The UI must not display demo transcript rows when the preload bridge is available.
- The UI must distinguish configured, missing, and invalid configuration states.
- The active API key value must never be sent to the renderer.
- Runtime start must continue to flow through `runMicSession()` and typed session events, not terminal output parsing.
- The live transcript pane and footer live-partial area must update from session events.

## Constraints

- Follow the existing TypeScript/Electron architecture.
- Do not add runtime dependencies.
- Do not perform version-control operations.
- Keep configuration secrets out of UI payloads and logs.
- Preserve context isolation, sandboxing, and the narrow preload bridge.

## Acceptance Criteria

- Opening `mic-tool-ts ui` shows resolved configuration state from CLI config sources before listening starts.
- If `SONIOX_API_KEY` is present in the supported config chain and Soniox is active, the UI shows `SONIOX_API_KEY` as configured and indicates the source tier.
- Starting a session from the UI emits visible lifecycle events and live partial/final transcript rows.
- Missing required configuration appears as a UI error and prevents a false-ready state.
- `pnpm typecheck`, focused tests, and the full test suite pass.
- Documentation records the defect and the applied solution.

## Assumptions

- UI edits are session settings for the next run; writing them back to `.env` is a separate feature.
- The user wants the installed `mic-tool-ts ui` command to remain the supported UI entry point.
- The UI must show whether a secret is configured, but not reveal or partially reveal the secret.

## Open Questions

None blocking.

## Original Request

> I was expecting to see the live transcription in the UI, and I cannot see it.
>
> I was expecting to see the configuration data from the configuration file, and I don't see it. It seems like the Soniox API key is not set, although it is configured. I don't understand what you are doing. It is not what I asked you to do, and I want you to fix it and make it a real working application that reflects the settings and operating mode and is capable of driving the operations of the command line tool through a UI.
>
> Is it clear, or do you need more clarification?
