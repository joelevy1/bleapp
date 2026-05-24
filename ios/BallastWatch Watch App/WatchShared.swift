import SwiftUI

enum TankRoute: String, CaseIterable, Hashable {
    case port = "Port"
    case starboard = "Starboard"
    case mid = "Mid"
    case forward = "Forward"
}

extension TankRoute {
    var phoneName: String { rawValue }

    var pctKey: String {
        switch self {
        case .port: return "portPct"
        case .starboard: return "stbdPct"
        case .mid: return "midPct"
        case .forward: return "fwdPct"
        }
    }

    var fillKey: String {
        switch self {
        case .port: return "portFill"
        case .starboard: return "stbdFill"
        case .mid: return "midFill"
        case .forward: return "fwdFill"
        }
    }

    var dispKey: String {
        switch self {
        case .port: return "portDisp"
        case .starboard: return "stbdDisp"
        case .mid: return "midDisp"
        case .forward: return "fwdDisp"
        }
    }

    var fillModeKey: String {
        switch self {
        case .port: return "fillPort"
        case .starboard: return "fillStbd"
        case .mid: return "fillMid"
        case .forward: return "fillFwd"
        }
    }

    var topKey: String {
        switch self {
        case .port: return "portTop"
        case .starboard: return "stbdTop"
        case .mid: return "midTop"
        case .forward: return "fwdTop"
        }
    }

    var btmKey: String {
        switch self {
        case .port: return "portBtm"
        case .starboard: return "stbdBtm"
        case .mid: return "midBtm"
        case .forward: return "fwdBtm"
        }
    }
}

enum WatchContextReader {
    static func intKey(_ key: String, in context: [String: Any]) -> Int {
        if let n = context[key] as? Int { return n }
        if let n = context[key] as? NSNumber { return n.intValue }
        return 0
    }

    static func stringKey(_ key: String, in context: [String: Any]) -> String {
        if let s = context[key] as? String { return s }
        if let n = context[key] as? NSNumber { return n.stringValue }
        return "—"
    }

    static func boolKey(_ key: String, in context: [String: Any], default defaultValue: Bool = true) -> Bool {
        if let v = context[key] as? Bool { return v }
        if let n = context[key] as? NSNumber { return n.boolValue }
        if let s = context[key] as? String {
            let t = s.trimmingCharacters(in: .whitespaces).lowercased()
            if t == "1" || t == "true" || t == "yes" { return true }
            if t == "0" || t == "false" || t == "no" { return false }
        }
        return defaultValue
    }

    static func hasContextKey(_ key: String, in context: [String: Any]) -> Bool {
        if context[key] != nil { return true }
        return intKey(key, in: context) != 0
    }

    static func bandColor(fillPct: Int) -> Color {
        if fillPct <= 75 { return .green }
        if fillPct <= 90 { return .yellow }
        return .red
    }
}
