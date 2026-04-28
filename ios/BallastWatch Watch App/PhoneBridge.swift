import Combine
import Foundation
import SwiftUI
import WatchConnectivity

/// Receives application context from the iPhone Ballast Monitor app.
final class PhoneBridge: NSObject, ObservableObject {
    static let shared = PhoneBridge()

    @Published var context: [String: Any] = [:]

    override private init() {
        super.init()
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    func sendAction(_ name: String) {
        guard WCSession.default.isReachable else { return }
        WCSession.default.sendMessage(["action": name], replyHandler: { _ in }, errorHandler: { _ in })
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
