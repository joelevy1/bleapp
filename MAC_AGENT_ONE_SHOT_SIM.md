# Mac Cursor — one-shot Simulator test (paste the ONE LINE below)

Open this file in the project, or after `git pull` tell the agent:

> **Read and execute `MAC_AGENT_ONE_SHOT_SIM.md` end-to-end. Run every command yourself. Do not ask me to paste logs unless signing/GUI blocks you. Do not push to main or trigger EAS.**

---

## Agent instructions (execute all)

You are the Mac/iOS agent on **LA623**. Work in **`~/dev/bleapp`**. Goal: get **Ballast Monitor** running in the **iPhone Simulator** (home screen visible) OR produce a **clear root-cause** with logs. **Do not** push to GitHub or run EAS unless the user explicitly says yes.

### 0. Sync repo

```bash
export VOLTA_HOME="$HOME/.volta"
export PATH="$VOLTA_HOME/bin:$PATH"
source ~/.bash_profile 2>/dev/null || true
cd ~/dev/bleapp
git pull origin main
node -v    # expect v20.x
npm ci
cd ios && pod install && cd ..
```

### 1. Simulator setup (critical)

- **Never** use `simctl … booted` when both iPhone and Watch are booted — install/launch targets the wrong device.
- **Shutdown Watch** before phone app tests:

```bash
xcrun simctl shutdown FC91D577-0C13-4270-84C2-2FD53348F5D9 2>/dev/null || true
open -a Simulator
```

In Simulator menu: **File → Open Simulator → iOS → iPhone 17 Pro** (any iPhone is OK; stay consistent).

```bash
IPHONE=E4BFEE4E-4664-4546-9612-DE0B1B3EEEE0
xcrun simctl list devices booted
```

Confirm **iPhone** line shows `(Booted)` for that UDID.

### 2. Build (if no recent Debug .app)

```bash
cd ~/dev/bleapp
npx expo run:ios --simulator "iPhone 17 Pro"
```

- Expect **Build Succeeded** (ignore `osascript` / System Events errors at the end).
- If watchOS missing: install via Xcode **Settings → Components** or `xcodebuild -downloadPlatform watchOS`.

Find the built app:

```bash
APP=$(find ~/Library/Developer/Xcode/DerivedData -name "BallastMonitor.app" -path "*Debug-iphonesimulator*" 2>/dev/null | head -1)
echo "APP=$APP"
test -n "$APP" || { echo "No .app — fix build first"; exit 1; }
```

### 3. Metro + install + launch (Debug)

**Terminal A** — leave running:

```bash
cd ~/dev/bleapp
npx expo start --localhost --clear
```

Wait until Metro is ready (no fatal errors).

**Terminal B**:

```bash
IPHONE=E4BFEE4E-4664-4546-9612-DE0B1B3EEEE0
APP=$(find ~/Library/Developer/Xcode/DerivedData -name "BallastMonitor.app" -path "*Debug-iphonesimulator*" 2>/dev/null | head -1)

xcrun simctl terminate $IPHONE com.joelevy.ballastmonitor 2>/dev/null
xcrun simctl uninstall $IPHONE com.joelevy.ballastmonitor 2>/dev/null
xcrun simctl install $IPHONE "$APP"
xcrun simctl launch $IPHONE com.joelevy.ballastmonitor
```

In **iPhone** Simulator window: **⌘R** reload.

**Smoke (30s):**

- [ ] Home UI (Connect to Boat / WiFi) — not white screen, not red “No bundle URL”
- [ ] Open **Settings** — no crash
- [ ] Optional deep link (Metro still running):

```bash
xcrun simctl openurl $IPHONE "ballastmonitor://wifi?ip=192.168.1.50"
```

WiFi dialog should show IP filled in.

### 4. If white screen or launch fails — capture logs

```bash
# Metro terminal: copy errors when app opens
npx react-native log-ios
# or:
xcrun simctl spawn $IPHONE log stream --predicate 'processImagePath contains "BallastMonitor"' --level debug
```

Check:

- Metro reachable at `http://localhost:8081` from the Mac
- `index.js` RootErrorBoundary should show JS errors (not blank white)
- `watchSync.js` uses **dynamic** import of `@plevo/expo-watch-connectivity` (must not block first paint)

Fix minimal issues on Mac; commit only if needed (use `[skip-eas]` in message unless user approved TestFlight).

### 5. Fallback — Release build (no Metro)

If Debug + Metro cannot work on this remote Mac:

```bash
cd ~/dev/bleapp
npx expo run:ios --configuration Release --simulator "iPhone 17 Pro"
```

Then launch via `simctl` on `$IPHONE` as above. Release embeds JS — should show real UI without Metro.

### 6. Report back to user

Reply with:

1. **Result:** green (home visible) / red (error summary)
2. **Root cause** (one sentence) if failed
3. **Files changed** + commit hash if you committed
4. **TestFlight:** native **Build Succeeded** already validates compile; Simulator optional for ship

**Constraints:** No `npm audit fix --force`. No production EAS. No push to `main` without `[skip-eas]` unless user approved TestFlight.

### Reference

- Bundle ID: `com.joelevy.ballastmonitor`
- Latest ship commit on main: watch fix + settings (`e757b80`+), handoff docs (`326bed5`+)
- Playbook: `MAC_AGENT_PLAYBOOK.md`
