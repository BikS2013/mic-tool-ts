# Investigation: Focused Control Text Delivery

Access date: 2026-05-20

Refined request: `docs/reference/refined-request-focused-control-text-delivery.md`

## Executive Summary

There is no single macOS API that universally inserts arbitrary text into the currently focused control across native text fields, browser editors, Electron apps, terminals, and custom editors without some trade-off.

The best path is a small macOS-native Swift helper that attempts delivery in this order:

1. Direct Accessibility insertion into the focused element when the target exposes a settable text value and selection range.
2. Unicode keyboard-event typing via `CGEventKeyboardSetUnicodeString` when direct Accessibility insertion is unsupported.
3. Clipboard-preserving paste via `NSPasteboard` plus a physical `Command+V` key-code event as the universal fallback.

This helper should be a user-level assistive tool, not a privileged system daemon. It needs Accessibility permission and possibly Input Monitoring depending on how it is combined with the existing global hotkey. Swift is the right implementation language for the helper because the relevant APIs are native macOS frameworks (`ApplicationServices`, `CoreGraphics`, `AppKit`) and can be packaged as a small binary that TypeScript/Electron calls.

## Context

The current focused-input operator in `src/protocol/controller.ts` copies the processed text using `pbcopy` and then runs:

```applescript
tell application "System Events" to keystroke "v" using command down
```

This is simple and broadly compatible, but it has two known weaknesses:

- It depends on the foreground app interpreting a paste shortcut at the right moment.
- It temporarily replaces the system clipboard unless explicit clipboard preservation is added.

The recent `Command+'` global hotkey issue adds another ordering risk: if the foreground app receives a leaked or delayed shortcut event, the user may see unintended selection behavior before the paste occurs.

## Research Questions

- Can `mic-tool-ts` deliver text to the focused control without using paste?
- Can a separate macOS helper improve reliability enough to justify another tool?
- Which approach is most universal across app families?
- What permissions and packaging model are required?
- What proof-of-concept checks should happen before production implementation?

## Options Identified

### Option 1: Keep Current AppleScript Paste, But Use Key Code

Replace `keystroke "v" using command down` with `key code 9 using command down`, and add a short delay after hotkey release before delivery.

This still uses paste, but it avoids layout-sensitive character interpretation. AppleScript references distinguish key codes from keystroke strings: key codes represent physical keys, while keystrokes represent Unicode key representations. The same reference lists `key code 9` as the physical `V` key.

Pros:

- Minimal code change.
- Keeps broad compatibility with controls that support paste.
- Avoids keyboard-layout surprises for `Command+V`.

Cons:

- Still overwrites the clipboard unless paired with clipboard preservation.
- Still depends on the focused app accepting paste.
- Does not answer the user's desire for non-paste insertion.

### Option 2: Clipboard-Preserving Native Paste Helper

Use a Swift helper that saves the current `NSPasteboard` contents, writes the transcript as text, posts physical `Command+V` with key code `9`, waits briefly, then restores the clipboard.

Pros:

- Most compatible across native apps, browsers, Electron apps, and terminals.
- Can use physical key codes through `CGEvent` rather than AppleScript character shortcuts.
- Preserves the user's clipboard in normal cases.
- Avoids shelling out to `pbcopy` and `osascript`.

Cons:

- Still paste-based.
- Clipboard restoration timing can race with slow target apps reading the pasteboard.
- Rich clipboard content preservation is more complex than plain text preservation.
- Requires Accessibility permission for event posting.

### Option 3: Direct Accessibility API Insertion

Use `AXUIElementCreateSystemWide()` and `kAXFocusedUIElementAttribute` to find the focused UI element. If it exposes a string `kAXValueAttribute`, a valid `kAXSelectedTextRangeAttribute`, and a settable `AXValue`, replace the selected range inside the value and set the updated value.

Apple documents `AXUIElement` as the structure used to refer to accessibility objects and exposes `AXUIElementSetAttributeValue`. The SDK headers say `AXValue` is generally writable but can be non-settable when another manipulation method is more appropriate. The headers also say `AXSelectedTextRange` is writable, while `AXSelectedText` is not writable.

Pros:

- Does not use paste.
- Does not touch the clipboard.
- Can be fast for standard native text fields.
- Can directly target the current focused element.

Cons:

- Not universal: many custom controls, terminals, browser contenteditables, Electron editors, and complex web apps may not expose settable `AXValue`.
- May fail with `kAXErrorAttributeUnsupported`, `kAXErrorNotImplemented`, `kAXErrorCannotComplete`, or `kAXErrorNoValue`.
- May bypass app-level input handlers, undo grouping, validation hooks, IME logic, and editor model synchronization.
- `AXSelectedText` itself is not writable according to the SDK header, so implementations that rely on setting selected text directly are target-dependent rather than contractually reliable.

### Option 4: Unicode Keyboard Event Typing

Use `CGEvent(keyboardEventSource:virtualKey:keyDown:)`, attach Unicode payloads with `CGEventKeyboardSetUnicodeString`, and post them to the HID/session event tap. This can type arbitrary Unicode without the clipboard and without translating text through a physical keyboard layout.

Apple documents `keyboardSetUnicodeString` as a way to override the Unicode string associated with a keyboard event, but warns that application frameworks may ignore that Unicode string and do their own translation from virtual keycode and event state.

Pros:

- Does not use paste.
- Does not touch the clipboard.
- Can handle Greek/English Unicode directly.
- More universal than direct AX for controls that accept normal keyboard text input.

Cons:

- Slower for large transcripts because it must post text as events, usually character-by-character.
- Some frameworks may ignore the Unicode string and use virtual keycode/state instead.
- Physical modifier state can still matter if not delayed until the hotkey is fully released.
- Requires Accessibility permission.
- Multiline text, combining characters, emoji, and IME interactions need explicit testing.

### Option 5: `AXUIElementPostKeyboardEvent`

Use the older Accessibility keyboard-posting API. The symbol still exists in the SDK, but modern CoreGraphics event APIs are better documented and more commonly used for synthetic keyboard input.

Pros:

- Native Accessibility event posting.
- Potentially simpler for ASCII keyboard events.

Cons:

- Less suitable for arbitrary Unicode transcript text.
- Poorer documentation and less clear future direction than `CGEvent`.
- Still synthetic keyboard input with permission requirements.

### Option 6: App-Specific Automation

Use AppleScript/JXA or application-specific APIs for known targets, such as TextEdit, Terminal, browsers, or specific editors.

Pros:

- Can be very reliable for a specific app when that app exposes a scripting interface.
- Can avoid clipboard use for some apps.

Cons:

- Not general.
- Requires a growing matrix of per-app adapters.
- Many modern editors and browser fields do not expose useful scriptable insertion APIs.
- Bad fit for the project's "focused active control" requirement.

### Option 7: Privileged System Tool / Daemon

Install a LaunchAgent, privileged helper, or system daemon that delivers text.

Pros:

- Could centralize permissions and be shared by future tools.
- A LaunchAgent can run persistently in the user's GUI session.

Cons:

- Privilege does not solve the core problem: macOS still routes UI automation through Accessibility/Input Monitoring permission and the focused app still decides what it supports.
- A root daemon is the wrong trust boundary for user-session UI insertion.
- Packaging, signing, updates, and uninstall complexity increase substantially.

## Comparison Matrix

| Option | Avoids paste | Preserves clipboard | Cross-app reliability | Unicode support | Permission burden | Implementation complexity | Recommendation |
|---|---:|---:|---:|---:|---:|---:|---|
| AppleScript key-code paste | No | No | High | High via pasteboard | Accessibility | Low | Short-term patch only |
| Swift clipboard-preserving paste | No | Yes | Highest | High via pasteboard | Accessibility | Medium | Universal fallback |
| Direct Accessibility insertion | Yes | Yes | Medium/low | High | Accessibility | Medium/high | First attempt when supported |
| CGEvent Unicode typing | Yes | Yes | Medium | Medium/high | Accessibility | Medium | Second attempt / fallback |
| AXUIElementPostKeyboardEvent | Yes | Yes | Low/medium | Low/medium | Accessibility | Medium | Do not prioritize |
| App-specific automation | Sometimes | Usually | Low globally | Varies | Varies | High over time | Avoid except opt-in adapters |
| Privileged helper/daemon | Depends | Depends | Does not improve core reliability | Depends | High | High | Not justified |

## Recommendation

Build a Swift user-level helper, not a privileged system tool.

Recommended command shape:

```text
mic-tool-ts-input-helper send --method auto
mic-tool-ts-input-helper diagnose
```

The helper should read text from stdin, never from command-line arguments, to avoid leaking transcripts through process lists. `mic-tool-ts` can spawn the helper and pass the processed output over stdin.

Recommended `auto` delivery order:

1. Wait 75-150 ms after hotkey release so physical modifier state settles.
2. Query the focused Accessibility element.
3. If `AXValue` is string-like, `AXValue` is settable, and `AXSelectedTextRange` is available, replace the selected range and move the cursor.
4. If direct AX insertion fails, post Unicode keyboard events with modifier flags cleared.
5. If Unicode typing fails or is disabled for long text, use clipboard-preserving key-code paste.

This order gives the user a real non-paste path where macOS and the target app support it, while preserving a universal fallback for browsers, terminals, and custom editors.

## Proof-of-Concept Status

Created `test_scripts/focused-text-delivery-poc.swift` with these modes:

- `diagnose [--prompt]`: checks Accessibility trust and prints the focused element role, value type, selected range, and relevant settable flags.
- `ax-insert <text> [--prompt]`: tries direct `AXValue` replacement using the selected text range.
- `unicode-type <text> [--prompt]`: posts Unicode keyboard events without clipboard use.
- `paste-keycode <text> [--prompt]`: writes text to `NSPasteboard` and posts physical `Command+V` key code `9`.

Compile check:

```text
swiftc test_scripts/focused-text-delivery-poc.swift -o /tmp/focused-text-delivery-poc
```

Result: compiled successfully.

Non-mutating diagnose check:

```text
/tmp/focused-text-delivery-poc diagnose
```

Result in this automation context:

```text
Could not read the focused UI element: AXError(rawValue: -25204)
```

`-25204` is `kAXErrorCannotComplete` in the local SDK headers. This does not disprove the approach; it confirms that AX messaging can fail depending on focused app/control/session state and should be handled as a fallback-capable best-effort path.

No mutating insertion mode was run automatically.

## Implementation Considerations

- Keep the TypeScript project as the orchestration layer; use Swift only for the macOS input helper.
- Do not pass transcript text in argv. Use stdin.
- Add a `diagnose` mode so the UI can explain exactly why direct insertion is unavailable.
- Return structured JSON status, for example:

```json
{"ok":true,"method":"ax-value","target_role":"AXTextArea"}
{"ok":true,"method":"unicode-events"}
{"ok":true,"method":"paste-keycode","clipboard_restored":true}
{"ok":false,"code":"accessibility_not_trusted","message":"..."}
```

- Treat missing Accessibility permission as an explicit warning/error, not a hidden fallback.
- Add a configurable delivery strategy only if needed later; start with `auto`.
- For clipboard-preserving paste, preserve common pasteboard types, not only plain text, if feasible.
- Manual verification should cover TextEdit, Notes, Terminal/iTerm2, Safari/Chrome textareas, Google Docs, VS Code/Cursor, Slack/Discord, and a Greek/English multiline transcript.

## Technical Research Guidance

Research needed before implementation: yes.

Recommended focused topics:

- Swift `AXUIElement` text-editing patterns for replacing selected range safely.
- `CGEventKeyboardSetUnicodeString` behavior with multiline Unicode text, Greek text, emoji, and common Electron/browser editors.
- Reliable pasteboard preservation/restoration with multiple pasteboard item types.
- Code-signing and permission behavior for a spawned helper binary versus code embedded in the Electron app.

## References

- Apple Developer Documentation, `AXUIElement`: https://developer.apple.com/documentation/applicationservices/axuielement
- Apple Developer Documentation, `AXUIElement.h`: https://developer.apple.com/documentation/applicationservices/axuielement_h
- Apple Developer Documentation, `kAXSelectedTextRangeAttribute`: https://developer.apple.com/documentation/applicationservices/kaxselectedtextrangesattribute
- Apple Developer Documentation, `kAXSelectedTextAttribute`: https://developer.apple.com/documentation/applicationservices/kaxselectedtextattribute
- Apple Developer Documentation, `kAXValueAttribute`: https://developer.apple.com/documentation/applicationservices/kaxvalueattribute
- Apple Developer Documentation, `CGEvent.keyboardSetUnicodeString`: https://developer.apple.com/documentation/coregraphics/cgevent/keyboardsetunicodestring%28stringlength%3Aunicodestring%3A%29
- Apple Developer Documentation, `CGEvent.post(tap:)`: https://developer.apple.com/documentation/coregraphics/cgevent/post%28tap%3A%29
- Local SDK: `/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/System/Library/Frameworks/ApplicationServices.framework/Versions/A/Frameworks/HIServices.framework/Versions/A/Headers/AXAttributeConstants.h`
- Local SDK: `/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/System/Library/Frameworks/ApplicationServices.framework/Versions/A/Frameworks/HIServices.framework/Versions/A/Headers/AXUIElement.h`
- Local SDK: `/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/System/Library/Frameworks/CoreGraphics.framework/Versions/A/Headers/CGEvent.h`
- Doug's AppleScripts, "System Events, Key Code and Keystroke": https://dougscripts.com/itunes/itinfo/keycodes.php
- Itsuki, "Swift/MacOS: Insert Text to (Other) Active Applications Two Ways": https://levelup.gitconnected.com/swift-macos-insert-text-to-other-active-applications-two-ways-9e2d712ae293

## Assumptions

- The target platform is macOS.
- The focused control belongs to the active user session.
- The user is willing to grant Accessibility permission.
- A helper binary may be acceptable if it is documented and invoked by `mic-tool-ts`.

## Open Questions

- Should clipboard preservation be mandatory, even if it introduces a small race after paste?
- Should the helper be distributed as an internal binary under the installed package or as a documented external tool?
- Which apps should define the first release's manual compatibility matrix?

## Original Request

> Can you investigate if there is any other way that the copy text could deliver to the focused control instead of pasting? 
> Even if that means we have to create a separate tool, even if this tool must be in other technology instead of TypeScript. 
> Can you examine if it’s working to create a system tool to send text to the focused control on the active application and active window?
