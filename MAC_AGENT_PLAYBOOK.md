# Ballast Monitor — PC vs Mac workflow (Cursor agents)

**Goal:** Minimal Mac time, maximum efficiency. **Mac = Apple-only work.** **PC = everything else.**

**Repos:** `C:\dev\bleapp` (PC) · `~/dev/bleapp` (Mac) · same remote: `joelevy1/bleapp`

---

## Division of labor

| Owner | Responsibilities |
|-------|------------------|
| **PC (Windows)** | Edit JS/docs/config; `npm ci`; Jest unit tests; git commit/push; GitHub Actions / EAS triggers (with user OK); code review in Cursor; issue templates; most agent refactors |
| **Mac (cloud or local)** | `pod install`; `expo run:ios` (Simulator); Metro repro of crashes; Xcode signing fixes; Maestro smoke on Simulator; native `ios/` edits when needed; read Simulator/Metro logs; commit **only** when Mac-only files change (or push after PC pull) |
| **Human** | Approve agent terminal commands; EAS production / TestFlight (**explicit yes**); Apple ID prompts; **real iPhone 13 Pro** + Pico BLE + Watch (not Simulator); TestFlight install smoke |

---

## What requires a Mac (do NOT offload to PC)

- iOS **Simulator** launch and **launch-crash** debugging (Metro redbox, native logs)
- **`cd ios && pod install`** and fixing Pod/Xcode project issues
- **`npx expo run:ios`** (simulator) and **`npx expo start`** for debug bundle
- **Maestro** (or Xcode UI tests) against Simulator
- Opening **`ios/BallastMonitor.xcworkspace`** for Watch target / signing / `pbxproj` fixes
- First-time or broken **provisioning** (`eas credentials` interactive) when CI fails

## What does NOT require a Mac (keep on PC)

- **`App.js`**, `watchSync.js`, `watchPayload.js`, plugins (JS), `app.json` (non-native), `eas.json` policy edits
- **`npm ci`**, **`npm test`** (Jest — add/maintain on PC)
- **Git** history, PRs, **`gh run view`** for failed Actions
- **Docs**, checklists, commit messages with **`[skip-eas]`** for non-ship commits
- Deciding **when** to trigger EAS (user must approve production credits)

## What neither agent fully replaces

- **BLE** to Pico (real hardware)
- **Apple Watch** companion on wrist
- **TestFlight** behavior identical to production (confirm after Simulator is clean)

---

## Mac session — start checklist (human, ~1 min)

```bash
export VOLTA_HOME="$HOME/.volta"
export PATH="$VOLTA_HOME/bin:$PATH"
source ~/.bash_profile 2>/dev/null || true
cd ~/dev/bleapp
git pull
node -v    # expect v20.x
npm ci
cd ios && pod install && cd ..
```

Open **Simulator** if not running: `open -a Simulator`

---

## Mac agent — default behavior

1. **Run commands yourself** in the project root; read terminal output; do not ask the user to paste logs unless blocked by GUI (signing, Apple login) or Simulator visibility.
2. **Prefer Simulator** for crash/launch issues; do not assume USB iPhone.
3. **Standard debug loop:**
   - `npx expo start` (background or second terminal)
   - Install/launch: find `BallastMonitor.app` under `~/Library/Developer/Xcode/DerivedData/.../Debug-iphonesimulator/` → `xcrun simctl install booted "$APP"` → `xcrun simctl launch booted com.joelevy.ballastmonitor`
   - If `osascript` / auto-open fails (remote Mac), use manual Simulator + `simctl` (documented above).
   - Reload (**⌃⌘Z** → Reload or Metro `r`); capture **full Metro ERROR / redbox** text.
4. **Fix native issues on Mac** only when needed; for **JS fixes**, either commit on Mac or list exact edits for PC — prefer **one branch, push from one machine** to avoid conflicts.
5. **Do not** run `eas build --profile production` or push to `main` without **`[skip-eas]`** unless the user explicitly approved a TestFlight build in chat.
6. **Do not** run `npm audit fix --force`.
7. After a fix verified in Simulator, report: **root cause**, **files changed**, **commit hash**, and whether **TestFlight / device retest** is still required.

---

## Mac agent — robust checks (run when asked or before “ship it”)

### A. Simulator smoke (required before recommending TestFlight)

- [ ] App launches without immediate crash
- [ ] Home UI visible (connect / tanks / settings entry)
- [ ] No uncaught error in Metro for 30s idle

### B. Maestro (add/maintain under `.maestro/`)

```bash
brew install mobile-dev-inc/tap/maestro   # once
maestro test .maestro/
```

Minimum flow: `launchApp` + `assertVisible` on stable home text.

### C. Native build sanity (after `ios/` or Podfile changes)

```bash
npx expo run:ios
# expect Build Succeeded
```

### D. Device / BLE (human — not Mac agent)

Hand off checklist in `DEBUG_SETUP_CHECKLIST.md` Part 7.

---

## PC agent — default behavior

1. Work in **`C:\dev\bleapp`** (not Google Drive).
2. Implement JS/tests/docs; run **`npm test`** when present.
3. Use **`[skip-eas]`** on commits that are not meant to queue TestFlight.
4. Before suggesting **production EAS**, confirm Simulator smoke on Mac (user or Mac agent reports green).
5. Remind: **`eas.json` `ascAppId`** should match App Store Connect Apple ID **`6762428994`** (verify in App Information).

---

## Git sync (avoid two-clone drift)

1. **Pull before work** on either machine.
2. **One pusher per feature** when possible (finish on Mac *or* PC, then pull on the other).
3. If both edited: `git pull --rebase` on the lagging machine before new commits.
4. **`volta pin`** on Mac may change `package.json` — commit intentionally or revert.

---

## EAS / TestFlight (minimal Mac)

| Profile | Trigger from | Mac needed? |
|---------|----------------|-------------|
| `preview` | GitHub Actions manual | No (after credentials exist) |
| `production` | Push `main` or Actions | No for build; Mac for debug *before* push |
| Interactive credentials | Once | Yes (`eas build` without `--non-interactive`) |

---

## Paste into **Mac Cursor** (Agent first message)

```text
Follow MAC_AGENT_PLAYBOOK.md in this repo.

You are the Mac/iOS agent. Work in ~/dev/bleapp. Run terminal commands yourself; read Metro and build output; do not ask me to paste logs unless signing or GUI blocks you.

Priorities:
1. Reproduce and fix launch/TestFlight-class crashes in iOS Simulator (Metro redbox).
2. Run Simulator smoke + Maestro if present before recommending TestFlight.
3. Only touch ios/ and native tooling when required; prefer JS fixes that PC can mirror via git.

Constraints:
- Simulator only (no USB iPhone).
- No production EAS build and no push to main without my explicit OK in chat.
- No npm audit fix --force.

When done with a fix: state root cause, files changed, commit hash, and whether I must retest on real device (BLE/Watch) or TestFlight.
```

---

## Paste into **PC Cursor** (Agent first message)

```text
Follow MAC_AGENT_PLAYBOOK.md — you are the PC agent.

Work in C:\dev\bleapp. Own JS, tests, docs, eas.json/app.json (non-native), and git/Actions. Do not ask me to run Mac commands; instead say what the Mac agent should run (short block) or note “Mac smoke required.”

Use [skip-eas] unless I explicitly approve a TestFlight/production build.

Before recommending production EAS: require Mac Simulator smoke (see playbook).
```

---

## Related files

- `DEBUG_SETUP_CHECKLIST.md` — step-by-step setup and hardware checklist
- `EAS_CI.md` — GitHub Actions, tokens, Watch credentials once
- `WATCH_XCODE_SETUP.md` — Watch target (rare Mac sessions)
