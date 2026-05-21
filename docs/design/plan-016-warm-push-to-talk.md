# Plan 016: Warm Push-To-Talk

Refined request: `docs/reference/refined-request-warm-push-to-talk.md`

## Goal
Keep UI push-to-talk ready before the first word by warming the existing microphone and realtime STT session, then using the hotkey only to gate real audio and commit the current utterance.

## Design
- Extend `Transcriber` with `commit()` for provider-specific utterance finalization without closing the realtime session.
- Extend `runMicSession()` with optional audio-gating and submit-pending controls:
  - closed gate: send same-length PCM silence chunks;
  - open gate: send real microphone chunks;
  - submit request: call `transcriber.commit()` and then submit pending protocol text.
- Keep normal CLI and manual UI Start/Stop behavior unchanged by making the gate optional and open by default.
- In Electron main, treat enabled push-to-talk as a hotkey-owned warmed session:
  - start warm session after settings load or when the hotkey is enabled;
  - open the gate on press;
  - close the gate and submit pending text on release;
  - stop the warmed session when push-to-talk is disabled, settings change, or the app exits.
- Preserve renderer fallback behavior by using the same preload IPC methods.

## Files To Modify
- `src/transcription/types.ts`
- `src/soniox/client.ts`
- `src/elevenlabs/client.ts`
- `src/core/sessionRunner.ts`
- `src/core/sessionEvents.ts`
- `src/ui/electronMain.ts`
- `src/ui/preload.cts`
- `src/ui/shared.ts`
- `src/ui/renderer/app.ts`
- `tests/main.test.ts`
- `tests/ui-settings.test.ts`
- `docs/design/project-design.md`
- `docs/design/project-functions.md`

## Verification
- `pnpm exec tsc -p . --noEmit`
- Focused Vitest runs for session runner, UI settings, and hotkey behavior.
