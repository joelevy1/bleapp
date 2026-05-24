# Mac agent — Simulator white screen (LA623)

**Repo:** `~/dev/bleapp` · **main** @ `e757b80+` · `com.joelevy.ballastmonitor`

## Goal

Fix debug Simulator **white screen** (or capture real error). Smoke: home UI (Connect / WiFi). **Do not push to main or EAS** unless the user says yes.

## Known environment

- Remote Mac; `osascript` / auto-open Simulator **fails** — use `simctl` only.
- **Do not use `booted`** when Watch + iPhone are both booted.
- **iPhone only:** `IPHONE=E4BFEE4E-4664-4546-9612-DE0B1B3EEEE0` (iPhone 17 Pro)
- **Shutdown Watch for phone tests:** `xcrun simctl shutdown FC91D577-0C13-4270-84C2-2FD53348F5D9`
- **App path:**
  `~/Library/Developer/Xcode/DerivedData/BallastMonitor-hijmkejpggzqtsfjwmambomoiqxd/Build/Products/Debug-iphonesimulator/BallastMonitor.app`
- **Already:** `npx expo run:ios` → **Build Succeeded** (native + Watch compile OK).

## Steps (run yourself)

```bash
cd ~/dev/bleapp && git pull origin main
xcrun simctl shutdown FC91D577-0C13-4270-84C2-2FD53348F5D9 2>/dev/null
open -a Simulator
# File → Open Simulator → iPhone 17 Pro
```

**Terminal A (keep open):**

```bash
cd ~/dev/bleapp
npx expo start --localhost --clear
```

**Terminal B:**

```bash
IPHONE=E4BFEE4E-4664-4546-9612-DE0B1B3EEEE0
APP=~/Library/Developer/Xcode/DerivedData/BallastMonitor-hijmkejpggzqtsfjwmambomoiqxd/Build/Products/Debug-iphonesimulator/BallastMonitor.app
xcrun simctl terminate $IPHONE com.joelevy.ballastmonitor 2>/dev/null
xcrun simctl install $IPHONE "$APP"
xcrun simctl launch $IPHONE com.joelevy.ballastmonitor
```

Simulator: **⌘R**. If white, read Metro +:

```bash
npx react-native log-ios
```

## If Metro path fails on remote Mac

Release build (JS embedded, no Metro):

```bash
cd ~/dev/bleapp
npx expo run:ios --configuration Release --simulator "iPhone 17 Pro"
```

## JS notes

- `index.js` — RootErrorBoundary (should show errors, not blank white).
- `watchSync.js` — dynamic `import('@plevo/expo-watch-connectivity')` after mount (must not block first paint).

## Success

- Home screen visible, **or** clear error + minimal fix.
- Report: root cause, files changed, commit hash.
- **TestFlight:** native build already passed; EAS does not need Simulator UI.

See also: `MAC_AGENT_PLAYBOOK.md`
