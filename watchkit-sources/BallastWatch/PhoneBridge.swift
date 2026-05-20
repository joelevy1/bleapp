import Combine
import Foundation
import SwiftUI
import WatchConnectivity

/// Receives application context from the iPhone Ballast Monitor app.
final class PhoneBridge: NSObject, ObservableObject {
    static let shared = PhoneBridge()

    /// Context older than this is treated as stale (waiting screen).
    static let staleContextMs: Double = 60_000

    @Published var context: [String: Any] = [:]

    override private init() {
        super.init()
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    var isBoatConnected: Bool {
        context["connected"] as? Bool ?? false
    }

    var contextAgeMs: Double? {
        guard let t = context["t"] as? NSNumber else { return nil }
        return Date().timeIntervalSince1970 * 1000 - t.doubleValue
    }

    var hasFreshContext: Bool {
        guard context["v"] != nil else { return false }
        guard let age = contextAgeMs else { return false }
        return age >= 0 && age < Self.staleContextMs
    }

    /// Show tank UI only when the phone reports a live boat connection with recent data.
    var shouldShowHome: Bool {
        isBoatConnected && hasFreshContext
    }

    var unitMode: String {
        if let u = context["unit"] as? String { return u }
        return "gallons"
    }

    func sendAction(_ name: String, tank: String? = nil, unit: String? = nil) {
        guard WCSession.default.isReachable else { return }
        var payload: [String: Any] = ["action": name]
        if let tank { payload["tank"] = tank }
        if let unit { payload["unit"] = unit }
        WCSession.default.sendMessage(payload, replyHandler: { _ in }, errorHandler: { _ in })
    }
}

extension PhoneBridge: WCSessionDelegate {
    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {}

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        DispatchQueue.main.async {
            self.context = applicationContext
        }
    }
}
