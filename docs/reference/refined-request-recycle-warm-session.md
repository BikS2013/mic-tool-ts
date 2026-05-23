# Refined Request: Recycle Warm Push-to-Talk Session

## Category

Development

## Objective

Enhance the push-to-talk warm session so that if it remains in the warmed idle state for five continuous minutes, the tool resets the current warm session and starts a fresh warm session from scratch.

## Scope

In scope:

- Add a five-minute warm-idle recycle timer for hotkey-owned warm sessions.
- Stop and restart the warm session only when it has remained warmed/idle continuously.
- Cancel or reset the timer while the hotkey is actively recording, when the session stops, when push-to-talk is disabled, or when the owner is not the hotkey warm session.
- Emit diagnostic/status events so the UI reflects the recycle instead of looking stuck.
- Update focused verification and project documentation.

Out of scope:

- Changing provider APIs or billing behavior.
- Changing manual listening sessions.
- Adding a user-facing configuration option for the timeout.
- Recycling while the user is actively holding the hotkey.

## Requirements

- The timeout MUST be five minutes.
- The timer MUST start only when the UI reports the hotkey session as warmed/ready with the audio gate closed.
- The timer MUST be cancelled while recording.
- When the timer fires, Electron main MUST stop the existing hotkey-owned session and then start a new warm session if push-to-talk is still enabled.
- Recycling MUST NOT create overlapping sessions.
- Recycling MUST clean up the old session through the existing shutdown path.

## Constraints

- No new runtime dependencies.
- Preserve the warmed push-to-talk architecture.
- Preserve strict configuration behavior.

## Acceptance Criteria

- A continuously warm idle session schedules one recycle after five minutes.
- Recording before five minutes cancels the pending recycle; releasing the hotkey starts a new five-minute window.
- A recycle stops the current hotkey session and starts a new warm session after shutdown.
- Existing typecheck, unit tests, build, and Electron bridge verification pass.

## Assumptions

- Five minutes is accepted as a fixed internal policy for now.
- Restarting the warmed session is preferable to sending a special provider keepalive because the goal is full local/process cleanup.

## Open Questions

None blocking.

## Original Request

> Given that this is just a warming-up process, can you enhance it so that it resets the connection and restarts the warming-up every, let’s say, five minutes, in case the process remains in “warming up” status for five minutes? It should reset the connection and the status, and start the warming-up process again from scratch to clean up any remaining long-running processes, tasks, or whatever else might be stuck.


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
