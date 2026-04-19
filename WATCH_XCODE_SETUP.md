# Apple Watch companion (manual Xcode step)

The iPhone app uses **`@plevo/expo-watch-connectivity`** and pushes tank data every ~2.5s via **WatchConnectivity application context**. Swift sources for the Watch UI live in **`watchkit-sources/BallastWatch/`**.

**EAS cloud builds** only compile the **iOS** app from this repo. To ship the Watch binary you must add a **watchOS target** in Xcode on a Mac and copy these Swift files into it (or add the folder as group references).

## 1. Generate the iOS project

```bash
cd bleapp
npx expo prebuild --platform ios
open ios/BallastMonitor.xcworkspace
```

(Use the `.xcworkspace` CocoaPods created.)

## 2. Add a Watch App target

1. **File → New → Target…**
2. Choose **watchOS → App** (or **Watch App for iOS App** depending on Xcode version).
3. Product name e.g. **BallastWatch**, bundle id e.g. `com.joelevy.ballastmonitor.watchkitapp`.
4. Ensure **Embed in Application** = Ballast Monitor (your iOS app).
5. Deployment **watchOS 9+** recommended (SwiftUI `NavigationView` / grid).

## 3. Replace default Watch sources

Delete the template `ContentView.swift` / app entry if needed, then **add** the files from this repo:

- `watchkit-sources/BallastWatch/BallastWatchApp.swift` — `@main` entry (remove duplicate `@main` from the template).
- `watchkit-sources/BallastWatch/PhoneBridge.swift`
- `watchkit-sources/BallastWatch/ContentView.swift`
- `watchkit-sources/BallastWatch/TankDetailView.swift`

Set **Watch App** target membership on all four files.

## 4. Signing

In Xcode, select the **Watch App** and **Watch Extension** targets (names vary), set your **Team**, unique bundle IDs, and enable **WatchKit** / **Watch Connectivity** capabilities if prompted.

## 5. Build & run

1. Build & run the **iOS** app on your iPhone (BLE/WiFi to Pico as today).
2. Select the **Watch** scheme and run on a paired Apple Watch.

The Watch reads **application context** from the phone; quick actions use **`sendMessage`** when the session is reachable (`resetAll`, `toggleFillDrain`, `disconnect`).

## 6. EAS

Continue using **`eas build --platform ios`** for TestFlight-style builds. After you **commit the `ios/` folder** (remove `/ios` from `.gitignore` if you want EAS to use your Watch target), configure EAS to build the workspace that includes the Watch target. Until then, **phone-only** builds work; Watch is added locally via Xcode.

## Complications (later)

WidgetKit complications need extra targets and `transferCurrentComplicationUserInfo` from the phone; not included in the first pass.

## EAS / Windows

If `eas build` fails during **upload** with `EPERM` / `rmdir` under `%TEMP%\eas-cli-nodejs`, that is a known pain point on some Windows setups (Google Drive, antivirus, or locked temp folders). Run the same command from **macOS**, **WSL**, or a clone in a short path like `C:\dev\bleapp`, or start the build from [expo.dev](https://expo.dev) after pushing to Git.
