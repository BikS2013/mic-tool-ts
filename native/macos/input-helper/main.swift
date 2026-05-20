import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

private let helperName = "mic-tool-ts-input-helper"
private let defaultMethod = "auto"
private let unicodeAutoThreshold = 500
private let hotkeySettleDelaySeconds: TimeInterval = 0.10
private let unicodeInterCharacterDelaySeconds: TimeInterval = 0.006
private let unicodePostDeliveryDelaySeconds: TimeInterval = 0.20
private let pasteboardRestoreDelaySeconds: TimeInterval = 0.25

enum ExitCode: Int32 {
    case success = 0
    case internalFailure = 1
    case expectedFailure = 2
}

struct HelperResult: Encodable {
    let ok: Bool
    let method: String?
    let code: String?
    let message: String?
    let targetRole: String?
    let targetSubrole: String?
    let clipboardRestored: Bool?
    let accessibilityTrusted: Bool?
    let focusedElementAvailable: Bool?
    let axValueReadable: Bool?
    let axValueSettable: Bool?
    let axSelectedTextRangeReadable: Bool?
    let axSelectedTextRangeSettable: Bool?
    let pasteboardAvailable: Bool?

    enum CodingKeys: String, CodingKey {
        case ok
        case method
        case code
        case message
        case targetRole = "target_role"
        case targetSubrole = "target_subrole"
        case clipboardRestored = "clipboard_restored"
        case accessibilityTrusted = "accessibility_trusted"
        case focusedElementAvailable = "focused_element_available"
        case axValueReadable = "ax_value_readable"
        case axValueSettable = "ax_value_settable"
        case axSelectedTextRangeReadable = "ax_selected_text_range_readable"
        case axSelectedTextRangeSettable = "ax_selected_text_range_settable"
        case pasteboardAvailable = "pasteboard_available"
    }

    static func success(
        method: String,
        targetRole: String? = nil,
        targetSubrole: String? = nil,
        clipboardRestored: Bool? = nil
    ) -> HelperResult {
        HelperResult(
            ok: true,
            method: method,
            code: nil,
            message: nil,
            targetRole: targetRole,
            targetSubrole: targetSubrole,
            clipboardRestored: clipboardRestored,
            accessibilityTrusted: nil,
            focusedElementAvailable: nil,
            axValueReadable: nil,
            axValueSettable: nil,
            axSelectedTextRangeReadable: nil,
            axSelectedTextRangeSettable: nil,
            pasteboardAvailable: nil
        )
    }

    static func failure(code: String, message: String) -> HelperResult {
        HelperResult(
            ok: false,
            method: nil,
            code: code,
            message: message,
            targetRole: nil,
            targetSubrole: nil,
            clipboardRestored: nil,
            accessibilityTrusted: nil,
            focusedElementAvailable: nil,
            axValueReadable: nil,
            axValueSettable: nil,
            axSelectedTextRangeReadable: nil,
            axSelectedTextRangeSettable: nil,
            pasteboardAvailable: nil
        )
    }
}

struct DeliveryFailure: Error {
    let code: String
    let message: String
}

struct ParsedCommand {
    let command: String
    let method: String
}

do {
    let parsed = try parseCommand(Array(CommandLine.arguments.dropFirst()))
    switch parsed.command {
    case "diagnose":
        emit(diagnose(), exitCode: .success)
    case "send":
        let text = readStdin()
        let result = try deliver(text: text, method: parsed.method)
        emit(result, exitCode: .success)
    default:
        throw DeliveryFailure(
            code: "invalid_command",
            message: "Usage: \(helperName) diagnose | send --method auto|ax-value|unicode-events|paste-keycode"
        )
    }
} catch let failure as DeliveryFailure {
    emit(.failure(code: failure.code, message: failure.message), exitCode: .expectedFailure)
} catch {
    emit(
        .failure(code: "internal_error", message: "Unexpected focused input helper failure."),
        exitCode: .internalFailure
    )
}

private func parseCommand(_ args: [String]) throws -> ParsedCommand {
    guard let command = args.first else {
        throw DeliveryFailure(
            code: "invalid_command",
            message: "Usage: \(helperName) diagnose | send --method auto|ax-value|unicode-events|paste-keycode"
        )
    }
    if command == "diagnose" {
        guard args.count == 1 else {
            throw DeliveryFailure(code: "invalid_command", message: "diagnose does not accept arguments.")
        }
        return ParsedCommand(command: command, method: defaultMethod)
    }
    guard command == "send" else {
        throw DeliveryFailure(code: "invalid_command", message: "Unknown helper command: \(command).")
    }

    var method = defaultMethod
    var index = 1
    while index < args.count {
        let arg = args[index]
        if arg == "--method" {
            guard index + 1 < args.count else {
                throw DeliveryFailure(code: "invalid_method", message: "--method requires a value.")
            }
            method = args[index + 1]
            index += 2
        } else {
            throw DeliveryFailure(code: "invalid_command", message: "Unknown send argument: \(arg).")
        }
    }
    guard ["auto", "ax-value", "unicode-events", "paste-keycode"].contains(method) else {
        throw DeliveryFailure(code: "invalid_method", message: "Unsupported focused input method: \(method).")
    }
    return ParsedCommand(command: command, method: method)
}

private func readStdin() -> String {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    return String(data: data, encoding: .utf8) ?? ""
}

private func emit(_ result: HelperResult, exitCode: ExitCode) -> Never {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    do {
        let data = try encoder.encode(result)
        if let json = String(data: data, encoding: .utf8) {
            print(json)
        } else {
            print("{\"code\":\"internal_error\",\"message\":\"Could not encode helper result.\",\"ok\":false}")
        }
    } catch {
        print("{\"code\":\"internal_error\",\"message\":\"Could not encode helper result.\",\"ok\":false}")
        exit(ExitCode.internalFailure.rawValue)
    }
    exit(exitCode.rawValue)
}

private func accessibilityTrusted(prompt: Bool = false) -> Bool {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt] as CFDictionary
    return AXIsProcessTrustedWithOptions(options)
}

private func requireAccessibility() throws {
    guard accessibilityTrusted() else {
        throw DeliveryFailure(
            code: "accessibility_not_trusted",
            message: "Grant Accessibility permission to \(helperName)."
        )
    }
}

private func diagnose() -> HelperResult {
    let trusted = accessibilityTrusted()
    let pasteboardAvailable = true

    guard trusted else {
        return HelperResult(
            ok: true,
            method: nil,
            code: nil,
            message: nil,
            targetRole: nil,
            targetSubrole: nil,
            clipboardRestored: nil,
            accessibilityTrusted: false,
            focusedElementAvailable: nil,
            axValueReadable: nil,
            axValueSettable: nil,
            axSelectedTextRangeReadable: nil,
            axSelectedTextRangeSettable: nil,
            pasteboardAvailable: pasteboardAvailable
        )
    }

    do {
        let element = try focusedElement()
        return HelperResult(
            ok: true,
            method: nil,
            code: nil,
            message: nil,
            targetRole: attributeString(element, kAXRoleAttribute),
            targetSubrole: attributeString(element, kAXSubroleAttribute),
            clipboardRestored: nil,
            accessibilityTrusted: true,
            focusedElementAvailable: true,
            axValueReadable: attributeString(element, kAXValueAttribute) != nil,
            axValueSettable: isSettable(element, kAXValueAttribute),
            axSelectedTextRangeReadable: selectedRange(element) != nil,
            axSelectedTextRangeSettable: isSettable(element, kAXSelectedTextRangeAttribute),
            pasteboardAvailable: pasteboardAvailable
        )
    } catch {
        return HelperResult(
            ok: true,
            method: nil,
            code: nil,
            message: nil,
            targetRole: nil,
            targetSubrole: nil,
            clipboardRestored: nil,
            accessibilityTrusted: true,
            focusedElementAvailable: false,
            axValueReadable: nil,
            axValueSettable: nil,
            axSelectedTextRangeReadable: nil,
            axSelectedTextRangeSettable: nil,
            pasteboardAvailable: pasteboardAvailable
        )
    }
}

private func deliver(text: String, method: String) throws -> HelperResult {
    switch method {
    case "auto":
        return try deliverAuto(text)
    case "ax-value":
        return try axInsert(text)
    case "unicode-events":
        return try unicodeType(text)
    case "paste-keycode":
        return try pasteWithKeyCode(text)
    default:
        throw DeliveryFailure(code: "invalid_method", message: "Unsupported focused input method: \(method).")
    }
}

private func deliverAuto(_ text: String) throws -> HelperResult {
    Thread.sleep(forTimeInterval: hotkeySettleDelaySeconds)

    do {
        return try axInsert(text)
    } catch let failure as DeliveryFailure where failure.code == "accessibility_not_trusted" {
        throw failure
    } catch {
        fputs("ax-value unavailable; trying unicode-events.\n", stderr)
    }

    if text.utf16.count <= unicodeAutoThreshold {
        do {
            return try unicodeType(text)
        } catch {
            fputs("unicode-events unavailable; trying paste-keycode.\n", stderr)
        }
    } else {
        fputs("unicode-events skipped for long text; trying paste-keycode.\n", stderr)
    }

    return try pasteWithKeyCode(text)
}

private func focusedElement() throws -> AXUIElement {
    let system = AXUIElementCreateSystemWide()
    var raw: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute as CFString, &raw)
    guard error == .success, let element = raw else {
        throw DeliveryFailure(
            code: "focused_element_unavailable",
            message: "Could not read the focused UI element."
        )
    }
    return element as! AXUIElement
}

private func axInsert(_ text: String) throws -> HelperResult {
    try requireAccessibility()
    let element = try focusedElement()
    let role = attributeString(element, kAXRoleAttribute)
    let subrole = attributeString(element, kAXSubroleAttribute)

    guard isSettable(element, kAXValueAttribute) else {
        throw DeliveryFailure(code: "value_not_settable", message: "AXValue is not settable on the focused element.")
    }
    guard let value = attributeString(element, kAXValueAttribute) else {
        throw DeliveryFailure(code: "value_unavailable", message: "AXValue is not readable on the focused element.")
    }
    guard let selection = selectedRange(element) else {
        throw DeliveryFailure(
            code: "selection_unavailable",
            message: "AXSelectedTextRange is not readable on the focused element."
        )
    }

    let utf16 = value.utf16
    guard
        selection.location >= 0,
        selection.length >= 0,
        selection.location <= utf16.count,
        selection.location + selection.length <= utf16.count
    else {
        throw DeliveryFailure(code: "selection_unavailable", message: "AXSelectedTextRange is outside AXValue bounds.")
    }

    let lower = String.Index(utf16Offset: selection.location, in: value)
    let upper = String.Index(utf16Offset: selection.location + selection.length, in: value)
    var next = value
    next.replaceSubrange(lower..<upper, with: text)

    let setValueError = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, next as CFString)
    guard setValueError == .success else {
        throw DeliveryFailure(code: "value_not_settable", message: "Could not set AXValue on the focused element.")
    }

    var cursor = CFRange(location: selection.location + text.utf16.count, length: 0)
    if let rangeValue = AXValueCreate(.cfRange, &cursor) {
        _ = AXUIElementSetAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, rangeValue)
    }

    return .success(method: "ax-value", targetRole: role, targetSubrole: subrole)
}

private func unicodeType(_ text: String) throws -> HelperResult {
    try requireAccessibility()
    guard let source = CGEventSource(stateID: .combinedSessionState) else {
        throw DeliveryFailure(code: "unicode_events_failed", message: "Could not create a keyboard event source.")
    }

    for character in text {
        var units = Array(String(character).utf16)
        guard
            let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
            let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
        else {
            throw DeliveryFailure(code: "unicode_events_failed", message: "Could not create Unicode keyboard events.")
        }
        down.flags = []
        up.flags = []
        down.keyboardSetUnicodeString(stringLength: units.count, unicodeString: &units)
        up.keyboardSetUnicodeString(stringLength: units.count, unicodeString: &units)
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
        Thread.sleep(forTimeInterval: unicodeInterCharacterDelaySeconds)
    }

    Thread.sleep(forTimeInterval: unicodePostDeliveryDelaySeconds)
    return .success(method: "unicode-events")
}

private final class PasteboardSnapshot {
    private let items: [[NSPasteboard.PasteboardType: Data]]

    init(_ pasteboard: NSPasteboard) {
        items = (pasteboard.pasteboardItems ?? []).map { item in
            var values: [NSPasteboard.PasteboardType: Data] = [:]
            for type in item.types {
                if let data = item.data(forType: type) {
                    values[type] = data
                }
            }
            return values
        }
    }

    func restore(to pasteboard: NSPasteboard) -> Bool {
        pasteboard.clearContents()
        guard !items.isEmpty else {
            return true
        }
        let restoredItems = items.map { values in
            let item = NSPasteboardItem()
            for (type, data) in values {
                item.setData(data, forType: type)
            }
            return item
        }
        return pasteboard.writeObjects(restoredItems)
    }
}

private func pasteWithKeyCode(_ text: String) throws -> HelperResult {
    try requireAccessibility()
    let pasteboard = NSPasteboard.general
    let snapshot = PasteboardSnapshot(pasteboard)

    pasteboard.clearContents()
    guard pasteboard.setString(text, forType: .string) else {
        throw DeliveryFailure(code: "pasteboard_unavailable", message: "Could not write focused input text to pasteboard.")
    }

    guard let source = CGEventSource(stateID: .combinedSessionState),
          let down = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: true),
          let up = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: false)
    else {
        _ = snapshot.restore(to: pasteboard)
        throw DeliveryFailure(code: "paste_keycode_failed", message: "Could not create Command-V keyboard events.")
    }

    down.flags = .maskCommand
    up.flags = .maskCommand
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)

    Thread.sleep(forTimeInterval: pasteboardRestoreDelaySeconds)
    let restored = snapshot.restore(to: pasteboard)
    return .success(method: "paste-keycode", clipboardRestored: restored)
}

private func attributeString(_ element: AXUIElement, _ attribute: String) -> String? {
    var raw: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &raw) == .success else {
        return nil
    }
    return raw as? String
}

private func isSettable(_ element: AXUIElement, _ attribute: String) -> Bool {
    var settable = DarwinBoolean(false)
    let error = AXUIElementIsAttributeSettable(element, attribute as CFString, &settable)
    return error == .success && settable.boolValue
}

private func selectedRange(_ element: AXUIElement) -> CFRange? {
    var raw: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, &raw)
    guard error == .success, let value = raw, CFGetTypeID(value) == AXValueGetTypeID() else {
        return nil
    }
    let axValue = value as! AXValue
    var range = CFRange()
    guard AXValueGetType(axValue) == .cfRange, AXValueGetValue(axValue, .cfRange, &range) else {
        return nil
    }
    return range
}
