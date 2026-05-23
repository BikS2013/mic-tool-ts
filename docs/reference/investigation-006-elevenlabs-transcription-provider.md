# Investigation: ElevenLabs Transcription Provider

## Executive Summary

ElevenLabs can support the `mic-tool-ts` realtime transcription use case. Its Realtime Speech to Text API exposes a WebSocket endpoint for Scribe Realtime v2, accepts audio chunks as base64 messages, and returns partial and committed transcript events. This maps cleanly to the existing `Transcriber` callback contract used by the renderer and guard-phrase turn detector.

## Context

`mic-tool-ts` currently captures macOS microphone audio as raw PCM and streams it to Soniox. The user asked whether ElevenLabs can be supported for transcription and, if feasible, added as an alternative option.

## Research Questions

- Does ElevenLabs provide realtime, streaming transcription rather than only file transcription?
- Can it accept the existing microphone audio format or a near equivalent?
- Does it provide partial and final transcript events?
- Can authentication work from a server-side CLI without exposing keys?
- What implementation risks are relevant for provider switching?

## Findings

- ElevenLabs documents a Realtime Speech to Text WebSocket endpoint at `wss://api.elevenlabs.io/v1/speech-to-text/realtime`.
- The realtime API supports partial transcript events while audio is being processed and committed transcript events after a commit.
- The API supports API-key authentication via the `xi-api-key` header; single-use tokens are an alternative for client-side browser use.
- Manual audio messages use `input_audio_chunk` with `audio_base_64` and `sample_rate`.
- The API supports manual commit and VAD-based commit strategies. The existing CLI needs timely committed transcript segments for guard-phrase detection, so VAD is the recommended default mapping when endpoint detection is enabled.
- The file-transcription endpoint is not the right primary fit because this tool streams live microphone audio.

## Options Compared

| Option | Fit | Complexity | Decision |
| --- | --- | --- | --- |
| ElevenLabs file transcription API | Poor for live mic streaming | Medium | Reject for this request |
| ElevenLabs SDK | Good capability fit | Adds larger provider-specific dependency surface | Defer |
| Direct ElevenLabs realtime WebSocket | Best fit with existing architecture | Moderate | Adopt |

## Recommendation

Implement ElevenLabs Scribe Realtime v2 as a second STT provider behind a provider-neutral transcriber factory. Keep Soniox as the default and require explicit `--stt-provider elevenlabs` selection so existing users are not affected.

## Implementation Considerations

- Use `ELEVENLABS_API_KEY` only for the ElevenLabs provider.
- Keep Soniox env vars unchanged.
- Prefer VAD commit strategy for ElevenLabs when endpoint detection is enabled.
- Do not use single-use tokens in this CLI; they are primarily for browser/client-side flows where exposing an API key would be unsafe.
- Use a small WebSocket runtime dependency if the project must support Node 20 reliably.

## References

- ElevenLabs Realtime Speech to Text API reference, accessed 2026-05-16: https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime
- ElevenLabs realtime client-side streaming guide, accessed 2026-05-16: https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/client-side-streaming
- ElevenLabs realtime event reference, accessed 2026-05-16: https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/event-reference
- ElevenLabs transcripts and commit strategies guide, accessed 2026-05-16: https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/transcripts-and-commit-strategies
- ElevenLabs API authentication reference, accessed 2026-05-16: https://elevenlabs.io/docs/api-reference/authentication
- ElevenLabs single-use token API reference, accessed 2026-05-16: https://elevenlabs.io/docs/api-reference/tokens/create
- ElevenLabs file transcription API reference, accessed 2026-05-16: https://elevenlabs.io/docs/api-reference/speech-to-text/convert

## Assumptions

- The Scribe Realtime API remains available for accounts with accepted Scribe terms.
- `scribe_v2_realtime` is the appropriate realtime model id for new integrations.
- The existing sample-rate range can remain shared, with provider query parameters matching the selected rate.

## Open Questions

- Live verification requires an ElevenLabs API key and an account that can use Scribe Realtime.

## Original Request

> I want you to find out if you can support the 11 Labs API for transcription purposes and, if you can, use it as an alternative option to Soniox.


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
