# Refined Request: Warm Push-To-Talk Capture

## Category
Development

## Objective
Reduce or eliminate the first-word loss in UI push-to-talk mode by warming the microphone and STT session before the hotkey is pressed, so hotkey press only gates live audio into an already-ready transcription pipeline.

## Scope
In scope:
- UI push-to-talk behavior in `mic-tool-ts ui`.
- Existing Soniox and ElevenLabs realtime transcriber implementations.
- Shared session runner behavior needed to gate microphone audio and commit the current utterance without shutting down the warmed session.
- Electron main and renderer behavior for hotkey-owned warmed sessions.
- Focused unit tests for audio gating, utterance commit, and hotkey warm lifecycle.
- Project design and functional requirements documentation.

Out of scope:
- Normal CLI invocation behavior.
- Manual UI Start/Stop semantics, except where needed to coexist with warmed hotkey mode.
- New STT providers, new dependencies, or package manifest changes.
- Full live microphone integration tests against real providers.

## Requirements
- When UI push-to-talk is enabled, `mic-tool-ts ui` must start and keep a hotkey-owned warmed session ready when configuration is valid.
- While warmed and the hotkey is not pressed, real microphone audio must not be sent to the STT provider.
- While idle, the warmed session must keep the provider connection alive by sending silence frames with the same byte length as captured PCM chunks.
- On hotkey press, the warmed session must immediately forward real microphone chunks to the provider without restarting the transcriber or `sox`.
- On hotkey release, the current provider utterance must be committed and the voice-agent protocol must submit pending text without closing the warmed session.
- Disabling push-to-talk or closing the app must stop the warmed session cleanly.
- Manual Start/Stop must remain independent and must not submit pending text unless the hotkey release path requests it.
- Startup/configuration errors must still be surfaced as typed session errors or UI warnings; no hidden configuration fallback is allowed.

## Constraints
- Do not add runtime dependencies.
- Keep the CLI behavior compatible with the existing `runMicSession()` flow.
- Avoid duplicating the transcription pipeline in Electron main.
- Maintain project documentation under `docs/design` and `docs/reference`.
- Preserve existing user changes and avoid version-control operations.

## Acceptance Criteria
- A focused session-runner test proves closed audio gate sends zeroed PCM chunks and open gate sends original chunks.
- A focused session-runner test proves a hotkey release can commit and submit pending text without stopping the transcriber or microphone.
- UI hotkey mode starts a warmed session before the first hotkey press and pressing the hotkey does not cold-start the session.
- Disabling push-to-talk stops any hotkey-owned warmed session.
- Typecheck and relevant tests pass.

## Assumptions
- Capturing microphone audio continuously while push-to-talk is enabled is acceptable because idle chunks are discarded locally and replaced by silence before provider transmission.
- Sending PCM silence frames while idle is acceptable for keeping realtime STT sessions warm and should not produce meaningful transcript text.
- Provider-level commit APIs can be reused without closing the provider session: Soniox via `finalize()`, ElevenLabs via an empty `commit: true` audio chunk.

## Open Questions
- None blocking for implementation.

## Original Request
i want you to implement this warm up approach
