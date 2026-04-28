import SwiftUI

@main
struct BallastWatchApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(PhoneBridge.shared)
        }
    }
}
