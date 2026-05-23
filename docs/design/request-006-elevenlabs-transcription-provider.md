# Refined Request: ElevenLabs Transcription Provider

## Category

Development, configuration, documentation, and external API research.

## Objective

Determine whether `mic-tool-ts` can support ElevenLabs for live transcription and, if feasible, implement ElevenLabs as an alternative realtime STT provider while preserving Soniox as the default provider.

## Scope

In scope:

- Add a transcription-provider selection option with `soniox` and `elevenlabs` choices.
- Preserve the existing Soniox behavior and configuration defaults.
- Add an ElevenLabs realtime transcription client that consumes the existing PCM microphone stream and emits the same partial/final callback contract used by the renderer and turn detector.
- Resolve ElevenLabs credentials only when `elevenlabs` is selected.
- Update tests and user/agent documentation for provider selection, provider-specific API keys, and provider-specific endpoint/model defaults.

Out of scope:

- Batch/file transcription through ElevenLabs `/v1/speech-to-text`.
- ElevenLabs text-to-speech or conversational-agent APIs.
- Replacing the guard-phrase turn detector or LLM refinement behavior.
- Live end-to-end verification against a real ElevenLabs account unless credentials are available in the environment.

## Requirements

- `mic-tool-ts` MUST keep `soniox` as the default transcription provider.
- `mic-tool-ts --stt-provider elevenlabs` MUST require `ELEVENLABS_API_KEY` or `--elevenlabs-api-key`.
- The ElevenLabs provider MUST connect to the realtime STT WebSocket endpoint, send base64 PCM chunks, and consume `partial_transcript` and `committed_transcript` events.
- The ElevenLabs provider MUST use VAD commits when endpoint detection is enabled, because the existing CLI depends on timely final transcript segments for guard-phrase detection.
- The CLI MUST keep stdout transcript-only and diagnostics on stderr.
- Missing provider-specific credentials MUST raise typed configuration errors instead of silently falling back to another provider or placeholder key.

## Constraints

- The installed command remains `mic-tool-ts`.
- The existing four-tier configuration chain remains CLI flag > local `.env` > per-user `.env` > shell environment.
- Runtime dependencies must be vetted before adding them and the project audit must pass after installation.
- Configuration values with explicit documented defaults may default; missing required secrets may not.

## Acceptance Criteria

- `resolveConfig()` returns Soniox provider settings by default and ElevenLabs provider settings when requested.
- Missing `SONIOX_API_KEY` is fatal only for Soniox; missing `ELEVENLABS_API_KEY` is fatal only for ElevenLabs.
- The orchestrator constructs the correct provider implementation from the resolved config.
- Unit tests cover provider selection, ElevenLabs configuration, WebSocket message handling, error mapping, and main-orchestrator provider dispatch.
- Documentation names the supported invocation as `mic-tool-ts` and documents ElevenLabs as an alternative STT provider.
- Typecheck, tests, and high-severity audit pass.

## Assumptions

- The existing microphone pipeline can remain raw `pcm_s16le` mono, with the sample rate supplied by config.
- ElevenLabs Scribe Realtime v2 is the correct realtime API for this use case.
- The low-level WebSocket API is a better fit than adding the full ElevenLabs SDK because the tool already owns microphone capture, chunking, rendering, and lifecycle control.
- `MIC_TOOL_TS_ENABLE_ENDPOINT_DETECTION=true` maps to ElevenLabs VAD commit strategy.

## Open Questions

None blocking. Live ElevenLabs verification still requires a real API key and accepted Scribe terms in the ElevenLabs dashboard.

## Original Request

> I want you to find out if you can support the 11 Labs API for transcription purposes and, if you can, use it as an alternative option to Soniox.


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
