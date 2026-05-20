# Focused Input Helper Design

Refined request: `docs/reference/refined-request-focused-input-helper-plan-design.md`
Implementation request: `docs/reference/refined-request-focused-input-helper-implementation.md`
Plan: `docs/design/plan-014-focused-input-helper.md`
Investigation: `docs/reference/investigation-focused-control-text-delivery.md`
Status: implemented 2026-05-20.

## Purpose

The focused input helper is a macOS-native delivery component for the existing `command input` operator. Its job is to send the final processed section output to the currently focused control in the active user session with better reliability and diagnostics than the former `pbcopy` plus System Events `Command+V` path.

The helper does not transcribe audio, refine text, translate text, own protocol state, or expose a new user-facing command. `mic-tool-ts` remains the public tool and the TypeScript process remains the orchestrator.

## Component Overview

### 1. Swift Helper Binary

Name: `mic-tool-ts-input-helper`

Responsibilities:

- Check Accessibility trust for its own process.
- Diagnose the currently focused UI element.
- Receive text on stdin.
- Deliver text with the configured method.
- Emit one structured JSON result on stdout.
- Keep human/debug diagnostics on stderr.
- Avoid storing transcript text.

Commands:

```text
mic-tool-ts-input-helper diagnose
mic-tool-ts-input-helper send --method auto
mic-tool-ts-input-helper send --method ax-value
mic-tool-ts-input-helper send --method unicode-events
mic-tool-ts-input-helper send --method paste-keycode
```

`auto` is the production default.

### 2. TypeScript Focused Input Adapter

Responsibilities:

- Resolve the helper path.
- Spawn the helper.
- Write the processed section output to helper stdin.
- Parse one JSON object from helper stdout.
- Capture helper stderr for warnings.
- Convert helper failures to existing protocol warnings.
- Preserve current test injection behavior for `VoiceAgentProtocolController`.

Expected API shape:

```ts
export interface FocusedInputDeliveryResult {
  readonly ok: boolean;
  readonly method?: "ax-value" | "unicode-events" | "paste-keycode";
  readonly code?: string;
  readonly message?: string;
  readonly targetRole?: string;
  readonly clipboardRestored?: boolean;
}

export async function sendToFocusedInput(text: string): Promise<FocusedInputDeliveryResult>;
```

The controller may keep its current `Promise<void>` writer contract internally by throwing on `ok: false`, or it may be widened to preserve method metadata for protocol/UI diagnostics.

### 3. Protocol Controller Integration

Existing owner: `VoiceAgentProtocolController`

Behavior:

- `input` operator remains a post-processing operator after refinement/translation.
- Successful helper delivery emits `input.sent`.
- Failed helper delivery emits `protocol.warning`.
- Focused-input delivery remains fail-open and must not terminate the session.
- The helper result may be used to add richer UI diagnostics later, but protocol compatibility should be preserved.

### 4. Build And Packaging Integration

Responsibilities:

- Compile the Swift helper during the package build.
- Copy the helper into `dist/native/macos/`.
- Ensure executable mode is set.
- Keep the public invocation as `mic-tool-ts`.

Recommended dist layout:

```text
dist/
  index.js
  protocol/
  ui/
  native/
    macos/
      mic-tool-ts-input-helper
```

## Delivery Algorithm

### Auto Mode

1. Read all stdin as UTF-8 text.
2. Sleep for a small configured internal delay, initially 75-150 ms, so hotkey modifier state has time to settle.
3. Try `ax-value`.
4. If `ax-value` returns an unsupported/not-settable/no-focused-element result, try `unicode-events`.
5. If Unicode typing fails or the text exceeds a practical length threshold, try `paste-keycode`.
6. Emit the final method result.

### AX Value Method

Use direct Accessibility insertion when the focused element supports it.

Steps:

1. Check `AXIsProcessTrustedWithOptions`.
2. Read `kAXFocusedUIElementAttribute` from the system-wide AX element.
3. Read role/subrole for diagnostics.
4. Read `kAXValueAttribute`.
5. Verify `kAXValueAttribute` is string-like and settable.
6. Read `kAXSelectedTextRangeAttribute`.
7. Replace the selected UTF-16 range in the current value.
8. Set the new `AXValue`.
9. Set `AXSelectedTextRange` to the cursor location after the inserted text when possible.

Expected strengths:

- No paste.
- No clipboard mutation.
- Good for standard AppKit text controls.

Expected limits:

- Complex browser/editor controls may not expose settable `AXValue`.
- Some targets may expose text markers instead of standard selected text ranges.
- Some apps may not update their internal editor model when AXValue is set.

### Unicode Events Method

Use synthetic keyboard text input when direct AX insertion is unavailable.

Steps:

1. Create a `CGEventSource`.
2. For each character or safe UTF-16 cluster, create key down/up events.
3. Clear modifier flags.
4. Attach Unicode payload with `CGEventKeyboardSetUnicodeString`.
5. Post to the HID/session event tap.

Expected strengths:

- No paste.
- No clipboard mutation.
- Works with controls that accept normal keyboard text input.

Expected limits:

- Some frameworks ignore the Unicode payload and translate based on virtual keycode and state.
- It is slower for long text.
- Multiline text and complex Unicode need manual verification.

### Paste Key-Code Method

Use paste as the universal fallback, but make it safer than the current path.

Steps:

1. Snapshot current `NSPasteboard` content.
2. Clear pasteboard and write the transcript as UTF-8 text.
3. Post physical `Command+V` using virtual key code `9`.
4. Wait briefly for the foreground app to read the pasteboard.
5. Restore prior pasteboard content as completely as practical.

Expected strengths:

- Most compatible with real target apps.
- Avoids AppleScript `keystroke "v"` layout sensitivity.
- Preserves clipboard in normal cases.

Expected limits:

- Still paste-based.
- Restoration can race with slow target apps.
- Rich pasteboard item preservation is more complex than plain text.

## Communication Contract

### Process Invocation

```text
mic-tool-ts-input-helper send --method auto
```

Input:

- stdin: exact text to deliver.
- argv: method only; never transcript text.

Output:

- stdout: one JSON object.
- stderr: human-readable diagnostics.
- exit code: stable status.

### Success Result

```json
{
  "ok": true,
  "method": "ax-value",
  "target_role": "AXTextArea"
}
```

```json
{
  "ok": true,
  "method": "paste-keycode",
  "clipboard_restored": true
}
```

### Failure Result

```json
{
  "ok": false,
  "code": "accessibility_not_trusted",
  "message": "Grant Accessibility permission to mic-tool-ts-input-helper."
}
```

Recommended codes:

- `accessibility_not_trusted`
- `focused_element_unavailable`
- `value_not_settable`
- `selection_unavailable`
- `unicode_events_failed`
- `pasteboard_unavailable`
- `delivery_timeout`
- `invalid_method`
- `internal_error`

### Exit Codes

| Code | Meaning |
|---:|---|
| `0` | Delivery succeeded. |
| `1` | Unexpected helper error. |
| `2` | Expected actionable failure, such as missing Accessibility permission or no focused editable target. |

## Deployment

### Development

During development, compile with `swiftc` or a Swift Package target. The plain `swiftc` path is simplest for the first implementation because the helper is a small single-purpose binary and avoids adding another package manager.

Example build step:

```text
swiftc native/macos/input-helper/main.swift -o dist/native/macos/mic-tool-ts-input-helper
```

### Packaged Runtime

The packaged runtime includes the helper under `dist/native/macos/`. `mic-tool-ts` resolves it relative to the compiled `dist/index.js` location.

The installed command remains:

```text
mic-tool-ts
```

Do not document `node dist/index.js`, `tsx src/index.ts`, package-manager scripts, or the helper binary as the primary user invocation.

### Permission Identity

macOS Accessibility permission attaches to the process identity that performs UI control. A spawned helper may appear separately from Terminal/Electron in System Settings. The implementation must detect untrusted status and surface instructions naming the helper or launcher that macOS reports.

Code signing should be evaluated before release because an unsigned helper path can produce unstable permission identity after rebuilds.

## Security And Privacy

- Transcript text must not appear in command-line arguments.
- Transcript text must not be written to persistent files.
- Helper stderr must not include transcript payloads.
- Helper stdout result must not echo transcript payloads.
- Clipboard fallback should restore previous clipboard content where practical.
- The helper must not run as root or require privileged installation.

## Configuration

Initial implementation should avoid new user configuration unless testing proves it is necessary.

Internal defaults:

- Method: `auto`.
- Hotkey-release settle delay: 75-150 ms.
- Unicode typing threshold: implementation-defined after testing.
- Pasteboard restore delay: implementation-defined after testing.

If future configuration is added, missing required values must raise explicit errors rather than falling back silently.

## Diagnostics

`diagnose` should report:

- Whether Accessibility trust is granted.
- Focused element role and subrole when readable.
- Whether `AXValue` is readable and settable.
- Whether `AXSelectedTextRange` is readable and settable.
- Whether Unicode event posting is available enough to attempt.
- Whether pasteboard access is available.

The UI can later expose this as a troubleshooting panel, but the first implementation can surface it through warnings and logs.

## Testing Strategy

### Automated Tests

TypeScript:

- Helper path resolution.
- Child-process stdin/stdout handling.
- Valid helper success result parsing.
- Malformed helper JSON handling.
- Expected helper failure mapping to `protocol.warning`.
- Successful helper delivery produces `input.sent`.
- Helper failure does not terminate the session.

Swift:

- Argument parsing.
- JSON result encoding.
- AX range replacement pure logic.
- Pasteboard snapshot/restore pure wrappers where possible.

Build:

- `pnpm build` creates `dist/native/macos/mic-tool-ts-input-helper`.
- Helper binary is executable.

### Manual Tests

Manual tests are mandatory because macOS focused-control behavior depends on target application implementation.

Targets:

- TextEdit.
- Notes.
- Terminal or iTerm2.
- Safari text area.
- Chrome text area.
- Google Docs or another contenteditable editor.
- VS Code.
- Cursor.
- Slack or Discord.

Payloads:

- English sentence.
- Greek sentence.
- Mixed Greek/English sentence.
- Punctuation-heavy text.
- Multiline text.
- Long paragraph.

Record for each target:

- Which method won in `auto`.
- Whether insertion happened at cursor.
- Whether selected text replacement worked.
- Whether undo works naturally.
- Whether clipboard was preserved.
- Whether any warning appeared.

## Implementation Sequence

1. Keep the current implementation available.
2. Move the Swift POC into production helper structure and establish JSON contract.
3. Add helper build output under `dist/native/macos/`.
4. Add TypeScript adapter with tests using mocked child processes.
5. Wire adapter into `VoiceAgentProtocolController`.
6. Update user docs.
7. Run manual compatibility matrix.
8. Decide whether the old `pbcopy`/System Events path remains as compatibility fallback or is removed after helper fallback proves sufficient.

## Open Decisions

- Whether to use plain `swiftc` or a Swift Package target.
- Whether clipboard preservation is mandatory from first helper release.
- Whether helper result method metadata should be emitted in protocol/UI events.
- Whether Accessibility permission instructions should name the helper, the launcher, or both.
