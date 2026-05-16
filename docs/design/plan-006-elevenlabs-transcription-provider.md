# Plan 006: ElevenLabs Transcription Provider

## Goal

Add ElevenLabs Scribe Realtime as an alternative transcription provider for `mic-tool-ts`, selected explicitly by configuration, with Soniox remaining the default.

## Design

### Configuration

- Add `--stt-provider <soniox|elevenlabs>` / `MIC_TOOL_TS_STT_PROVIDER`, default `soniox`.
- Keep existing Soniox flags and env vars working.
- Add `--elevenlabs-api-key` / `ELEVENLABS_API_KEY`.
- Add `--elevenlabs-api-key-expires-at` / `ELEVENLABS_API_KEY_EXPIRES_AT`.
- Reuse `--model`, `--endpoint`, `--language`, `--sample-rate`, and `--no-endpoint-detection` for the active STT provider.
- Resolve provider defaults before validation:
  - Soniox model: `stt-rt-v4`.
  - Soniox endpoint: `wss://stt-rt.soniox.com/transcribe-websocket`.
  - ElevenLabs model: `scribe_v2_realtime`.
  - ElevenLabs endpoint: `wss://api.elevenlabs.io/v1/speech-to-text/realtime`.

### Transcriber Abstraction

- Introduce a provider-neutral `Transcriber` contract under `src/transcription/`.
- Move provider selection into `createTranscriber(config.transcription)`.
- Keep `src/soniox/client.ts` as the Soniox implementation.
- Add `src/elevenlabs/client.ts` as the ElevenLabs implementation.

### ElevenLabs Client Behavior

- Connect using WebSocket headers: `xi-api-key: <ELEVENLABS_API_KEY>`.
- Build query params for `model_id`, `audio_format`, `sample_rate`, `commit_strategy`, and optional `language_code`.
- Send each microphone chunk as:

```json
{
  "message_type": "input_audio_chunk",
  "audio_base_64": "<base64 pcm chunk>",
  "sample_rate": 16000
}
```

- Emit `onPartial(text)` for `partial_transcript`.
- Emit `onFinal(text)` for `committed_transcript` and `committed_transcript_with_timestamps`.
- Map authentication, network, quota, rate-limit, and protocol errors into the shared typed error taxonomy.
- On shutdown, send a best-effort final commit message, then close the WebSocket within the existing bounded shutdown expectation.

### Documentation

- Update `README.md`, `docs/tools/mic-tool-ts.md`, `docs/design/project-functions.md`, `docs/design/project-design.md`, and `docs/design/configuration-guide.md`.
- Record dependency vetting for the WebSocket package in `Issues - Pending Items.md`.
- Add the investigation report under `docs/reference`.

## Verification

- Unit tests for config provider selection.
- Unit tests for ElevenLabs client event handling and error mapping.
- Orchestrator tests for provider factory dispatch.
- Run `pnpm typecheck`, `pnpm test`, and `pnpm audit --audit-level=high`.
