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

    /// JS / plist often delivers booleans as NSNumber — do not use `as? Bool` only.
    var isBoatConnected: Bool {
        WatchContextReader.boolKey("connected", in: context, default: false)
    }

    var contextAgeMs: Double? {
        guard let t = context["t"] as? NSNumber else { return nil }
        return Date().timeIntervalSince1970 * 1000 - t.doubleValue
    }

    var hasFreshContext: Bool {
        guard WatchContextReader.hasContextKey("v", in: context) else { return false }
        guard let age = contextAgeMs else { return false }
        return age >= 0 && age < Self.staleContextMs
    }

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

    private func applyContext(_ applicationContext: [String: Any]) {
        guard !applicationContext.isEmpty else { return }
        context = applicationContext
    }

    private func applyPayloadIfBallast(_ payload: [String: Any]) {
        guard WatchContextReader.hasContextKey("v", in: payload) else { return }
        applyContext(payload)
    }
}

extension PhoneBridge: WCSessionDelegate {
    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        // Phone may have sent context before the watch app opened — read the latest cached payload.
        DispatchQueue.main.async {
            self.applyContext(session.receivedApplicationContext)
        }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        DispatchQueue.main.async {
            self.applyPayloadIfBallast(applicationContext)
        }
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        DispatchQueue.main.async {
            self.applyPayloadIfBallast(userInfo)
        }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        DispatchQueue.main.async {
            self.applyPayloadIfBallast(message)
        }
    }

    func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        DispatchQueue.main.async {
            self.applyPayloadIfBallast(message)
        }
        replyHandler(["ok": 1])
    }
}
