# Ballast Monitor — debug & ship checklist

Keep this file open in Cursor (`C:\dev\ballast-app`). Check boxes as you go.

**PC repo path:** `C:\dev\ballast-app`  
**Mac repo path:** `~/dev/ballast-app`  
**Expo project:** [ballast-monitor](https://expo.dev) · bundle `com.joelevy.ballastmonitor`

---

## Part 0 — One-time setup

### 0A — PC (Windows)

- [ ] Folder exists: `C:\dev\ballast-app` (if `git clone` says “already exists”, that’s OK)
- [ ] In PowerShell: `cd C:\dev\ballast-app` then `npm ci` (completes without errors)
- [ ] Cursor: **File → Open Folder** → `C:\dev\ballast-app` (not Google Drive)
- [ ] Verify git: `git remote -v` shows `joelevy1/ballast-app`
- [ ] Verify tip: `git log -1 --oneline`

### 0A — Mac (remote)

- [ ] `mkdir -p ~/dev && cd ~/dev`
- [ ] Clone or update: `cd bleapp && git pull` (or `git clone https://github.com/joelevy1/ballast-app.git bleapp`)
- [ ] Node 20 + `npm ci`
- [ ] `cd ios && pod install && cd ..`
- [ ] Xcode installed; **Xcode → Settings → Accounts** → your Apple team signed in

### 0B — Cursor (no special toggle required)

- [ ] When the agent proposes a terminal command, click **Run** / **Allow** (that’s how the agent uses the terminal)
- [ ] _(Optional)_ **Ctrl+Shift+P** → “Cursor Settings” → search “allowlist” if you want fewer prompts later

### 0C — GitHub CLI (optional — skip is fine)

- [ ] _(Optional)_ `winget install GitHub.cli` then `gh auth login`
- [ ] Or use browser: https://github.com/joelevy1/ballast-app/actions

---

## Part 1 — Debug crash (use this loop, not TestFlight)

**Goal:** See the real JS error in Metro, not only `.ips` files.

### Before each Mac session

- [ ] Mac: `cd ~/dev/ballast-app && git pull`
- [ ] Mac: `npm ci`
- [ ] Mac: `cd ios && pod install && cd ..` (only if `ios/` or native deps changed)

### Run on iPhone (Mac)

- [ ] iPhone USB → Trust Mac → **Developer Mode** on if iOS asks
- [ ] Terminal 1: `cd ~/dev/ballast-app && npx expo run:ios --device`  
  _(or Xcode: `open ios/BallastMonitor.xcworkspace` → scheme **BallastMonitor** → your iPhone → **Run** ⌘R)_

### Metro (Mac)

- [ ] Terminal 2: `cd ~/dev/ballast-app && npx expo start`  
  _(different Wi‑Fi? use `npx expo start --tunnel`)_
- [ ] Reload app; reproduce crash
- [ ] Copy **redbox text** or **Metro terminal error** into chat / notes

### Watch (after phone works)

- [ ] Watch paired to iPhone
- [ ] Test tank data on Watch (~5 s after phone connect)

---

## Part 2 — Daily sync (PC edit ↔ Mac run)

| Change type | PC | Mac |
|-------------|----|-----|
| JS only (`App.js`, etc.) | edit → commit → push | `git pull` → `npx expo start` → reload |
| Native (`ios/`, plugins, new npm native pkg) | edit → commit → push | `git pull` → `pod install` → rebuild (`expo run:ios` or Xcode ⌘R) |

---

## Part 3 — Jest on PC (optional, recommended)

- [ ] `npm install --save-dev jest jest-expo @types/jest`
- [ ] Add `jest.config.js` with `preset: 'jest-expo'`
- [ ] Add `"test": "jest"` to `package.json` scripts
- [ ] `npm test` passes

---

## Part 4 — Maestro smoke on Mac (optional)

- [ ] `brew install mobile-dev-inc/tap/maestro`
- [ ] Create `.maestro/launch.yaml` with `appId: com.joelevy.ballastmonitor`
- [ ] App installed on device/simulator → `maestro test .maestro/launch.yaml`

---

## Part 5 — Release crash clues (optional)

### Console.app (TestFlight repro)

- [ ] Mac: **Console.app** → select iPhone → Start stream
- [ ] Filter: `BallastMonitor` or `process:BallastMonitor`
- [ ] Launch TestFlight app → save log lines before exit

### Sentry (optional, needs repo change)

- [ ] Sentry project + DSN in EAS secrets → one production build → check dashboard on crash

---

## Part 6 — EAS / TestFlight (slow — only when debug loop is clean)

### Preview (internal install, no TestFlight)

- [ ] GitHub → **Actions** → **EAS iOS build** → **Run workflow** → profile **`preview`**
- [ ] Approve **eas-build** environment if GitHub asks
- [ ] Install from Expo build page / QR

### Production (TestFlight)

- [ ] Fix `eas.json` **`ascAppId`** to match App Store Connect Apple ID (**`6762428994`** per crash log — verify in App Information)
- [ ] Push to `main` **without** `[skip-eas]` when you want a build
- [ ] Or: Actions → Run workflow → **`production`** or **`production_xcode26`**
- [ ] Expo build succeeds → auto-submit (if ASC API key configured)
- [ ] App Store Connect → TestFlight → install build **N** → note commit hash on Expo build page

### Skip CI build (docs only)

- [ ] Put **`[skip-eas]`** in the commit message

---

## Part 7 — Hardware manual test (~5 min)

- [ ] Pico on, BLE advertising
- [ ] App opens without instant crash
- [ ] Connect → BLE device found → connected
- [ ] Tank values update
- [ ] Settings / WiFi IP (if used)
- [ ] Watch shows summary
- [ ] Fill/drain toggle works

---

## Part 8 — Paste this when asking for help in Cursor

```
PC: C:\dev\ballast-app @ commit _______
Mac pulled same commit: yes / no
Build: Debug (Metro) / TestFlight build ___
Metro or redbox error:
Console.app snippet (if any):
Pico BLE: yes / no
Watch: yes / no
EAS OK: preview only / production / skip
```

---

## Suggested order (first week)

1. [ ] Part 0 PC + Mac clones  
2. [ ] Part 1 — Metro error from Debug build  
3. [ ] Fix on PC, push, repeat Part 1  
4. [ ] Part 3 Jest (optional)  
5. [ ] Part 4 Maestro (optional)  
6. [ ] Part 6 production TestFlight only to confirm fix  

---

## Quick commands cheat sheet

**PC**
```powershell
cd C:\dev\ballast-app
git pull
npm ci
git status
```

**Mac**
```bash
cd ~/dev/ballast-app
git pull
npm ci
cd ios && pod install && cd ..
npx expo run:ios --device
# 2nd terminal:
npx expo start
# or: npx expo start --tunnel
```

**Open Xcode workspace**
```bash
open ~/dev/ballast-app/ios/BallastMonitor.xcworkspace
```
