#!/usr/bin/env swift

import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

enum DeliveryError: Error, CustomStringConvertible {
    case accessibilityNotTrusted
    case focusedElementUnavailable(AXError)
    case attributeUnavailable(String, AXError)
    case attributeNotSettable(String)
    case invalidSelection
    case usage

    var description: String {
        switch self {
        case .accessibilityNotTrusted:
            return "Accessibility permission is not granted for this process."
        case let .focusedElementUnavailable(error):
            return "Could not read the focused UI element: \(error)"
        case let .attributeUnavailable(name, error):
            return "Could not read \(name): \(error)"
        case let .attributeNotSettable(name):
            return "\(name) is not settable on the focused UI element."
        case .invalidSelection:
            return "The focused element did not expose a valid selected text range."
        case .usage:
            return """
            Usage:
              swift test_scripts/focused-text-delivery-poc.swift diagnose [--prompt]
              swift test_scripts/focused-text-delivery-poc.swift ax-insert <text> [--prompt]
              swift test_scripts/focused-text-delivery-poc.swift unicode-type <text> [--prompt]
              swift test_scripts/focused-text-delivery-poc.swift paste-keycode <text> [--prompt]
            """
        }
    }
}

struct Arguments {
    let command: String
    let text: String?
    let prompt: Bool
}

let args = Array(CommandLine.arguments.dropFirst())

do {
    let parsed = try parseArguments(args)
    try requireAccessibility(prompt: parsed.prompt)

    switch parsed.command {
    case "diagnose":
        try diagnoseFocusedElement()
    case "ax-insert":
        try axInsert(parsed.text ?? "")
    case "unicode-type":
        unicodeType(parsed.text ?? "")
    case "paste-keycode":
        pasteWithKeyCode(parsed.text ?? "")
    default:
        throw DeliveryError.usage
    }
} catch let error as DeliveryError {
    fputs("\(error.description)\n", stderr)
    exit(2)
} catch {
    fputs("\(error)\n", stderr)
    exit(1)
}

func parseArguments(_ args: [String]) throws -> Arguments {
    guard let command = args.first else { throw DeliveryError.usage }
    let prompt = args.contains("--prompt")
    let values = args.dropFirst().filter { $0 != "--prompt" }
    let text = values.isEmpty ? nil : values.joined(separator: " ")
    return Arguments(command: command, text: text, prompt: prompt)
}

func requireAccessibility(prompt: Bool) throws {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt] as CFDictionary
    if !AXIsProcessTrustedWithOptions(options) {
        throw DeliveryError.accessibilityNotTrusted
    }
}

func focusedElement() throws -> AXUIElement {
    let system = AXUIElementCreateSystemWide()
    var raw: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute as CFString, &raw)
    guard error == .success, let element = raw else {
        throw DeliveryError.focusedElementUnavailable(error)
    }
    return element as! AXUIElement
}

func diagnoseFocusedElement() throws {
    let element = try focusedElement()
    print("trusted: true")
    print("role: \(attributeString(element, kAXRoleAttribute) ?? "unknown")")
    print("subrole: \(attributeString(element, kAXSubroleAttribute) ?? "none")")
    print("value_type: \(attributeTypeDescription(element, kAXValueAttribute))")
    print("selected_text_range: \(selectedRangeDescription(element))")
    print("AXValue_settable: \(isSettable(element, kAXValueAttribute))")
    print("AXSelectedTextRange_settable: \(isSettable(element, kAXSelectedTextRangeAttribute))")
    print("AXSelectedText_settable: \(isSettable(element, kAXSelectedTextAttribute))")
}

func axInsert(_ text: String) throws {
    let element = try focusedElement()
    guard isSettable(element, kAXValueAttribute) else {
        throw DeliveryError.attributeNotSettable("AXValue")
    }
    guard let value = attributeString(element, kAXValueAttribute) else {
        throw DeliveryError.attributeUnavailable("AXValue", .noValue)
    }
    guard let selection = selectedRange(element) else {
        throw DeliveryError.invalidSelection
    }

    let utf16 = value.utf16
    guard
        selection.location >= 0,
        selection.length >= 0,
        selection.location <= utf16.count,
        selection.location + selection.length <= utf16.count
    else {
        throw DeliveryError.invalidSelection
    }

    let lower = String.Index(utf16Offset: selection.location, in: value)
    let upper = String.Index(utf16Offset: selection.location + selection.length, in: value)
    var next = value
    next.replaceSubrange(lower..<upper, with: text)
    let setValueError = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, next as CFString)
    guard setValueError == .success else {
        throw DeliveryError.attributeUnavailable("set AXValue", setValueError)
    }

    var cursor = CFRange(location: selection.location + text.utf16.count, length: 0)
    if let rangeValue = AXValueCreate(.cfRange, &cursor) {
        _ = AXUIElementSetAttributeValue(
            element,
            kAXSelectedTextRangeAttribute as CFString,
            rangeValue
        )
    }
}

func unicodeType(_ text: String) {
    let source = CGEventSource(stateID: .combinedSessionState)
    for character in text {
        var units = Array(String(character).utf16)
        guard let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
              let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
        else {
            continue
        }
        down.flags = []
        up.flags = []
        down.keyboardSetUnicodeString(stringLength: units.count, unicodeString: &units)
        up.keyboardSetUnicodeString(stringLength: units.count, unicodeString: &units)
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    }
}

func pasteWithKeyCode(_ text: String) {
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    pasteboard.setString(text, forType: .string)

    let source = CGEventSource(stateID: .combinedSessionState)
    guard let down = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: true),
          let up = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: false)
    else {
        return
    }
    down.flags = .maskCommand
    up.flags = .maskCommand
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
}

func attributeString(_ element: AXUIElement, _ attribute: String) -> String? {
    var raw: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &raw) == .success else {
        return nil
    }
    return raw as? String
}

func attributeTypeDescription(_ element: AXUIElement, _ attribute: String) -> String {
    var raw: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, attribute as CFString, &raw)
    guard error == .success, let value = raw else {
        return "\(error)"
    }
    return String(describing: type(of: value))
}

func isSettable(_ element: AXUIElement, _ attribute: String) -> Bool {
    var settable = DarwinBoolean(false)
    let error = AXUIElementIsAttributeSettable(element, attribute as CFString, &settable)
    return error == .success && settable.boolValue
}

func selectedRange(_ element: AXUIElement) -> CFRange? {
    var raw: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(
        element,
        kAXSelectedTextRangeAttribute as CFString,
        &raw
    )
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

func selectedRangeDescription(_ element: AXUIElement) -> String {
    guard let range = selectedRange(element) else { return "unavailable" }
    return "location=\(range.location), length=\(range.length)"
}
