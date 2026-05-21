# Refined Request: UI Hotkey Warm Status

## Category

Development

## Objective

Update the Electron UI so push-to-talk warmed sessions show an accurate state after the hotkey is released. The UI must distinguish active recording from the warmed idle session that remains connected with the audio gate closed.

## Scope

In scope:

- Add a typed UI event for push-to-talk capture state.
- Show a non-recording indication when the hotkey session is warmed but not forwarding microphone audio.
- Show an active recording/listening indication only while the push-to-talk gate is open or a manual listening session is active.
- Keep the warmed session behavior itself unchanged.
- Update focused renderer verification and project docs.

Out of scope:

- Changing STT provider behavior.
- Removing warmed push-to-talk sessions.
- Changing the hotkey binding or operator pipeline.
- Changing manual Start/Stop semantics beyond clearer labels.

## Requirements

- The renderer MUST not label a warmed idle push-to-talk session as active recording.
- The renderer MUST show an active capture indication while the hotkey is held.
- Releasing the hotkey MUST return the UI to a warmed/ready indication while keeping the backend warmed session alive.
- The Stop button MUST communicate that it stops the warmed session when the session is warmed but idle.
- The fix MUST use typed UI events rather than parsing free-form diagnostic messages.

## Constraints

- No new runtime dependencies.
- Preserve the warmed push-to-talk architecture.
- Keep configuration rules unchanged.

## Acceptance Criteria

- After hotkey release, the status chip no longer says `Listening`.
- During hotkey hold, the status chip indicates active recording/listening.
- The button label distinguishes stopping a warmed session from stopping active listening.
- Existing typecheck, tests, build, and Electron bridge verification pass.

## Assumptions

- `warm` means the session runner is alive but the audio gate is closed and real microphone audio is not sent to the STT provider.
- `recording` means the push-to-talk audio gate is open.

## Open Questions

None blocking.

## Original Request

> can you fix it to show a correct indication ?
