# EAS build automation

Use **GitHub Actions** so builds are submitted from **Linux** (reliable). Local `eas build` on Windows often fails during upload with `EPERM` / `rmdir` under `%TEMP%` (Google Drive, antivirus, or eas-cli cleanup); **WSL** is the best local fallback.

## GitHub Actions (recommended)

Builds run on **Ubuntu**, so the Windows `EPERM` / `rmdir` issue during upload does not occur.

1. Create an Expo access token: **https://expo.dev/accounts/&lt;you&gt;/settings/access-tokens** (scope: at least **Build**).
2. In the GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `EXPO_TOKEN`
   - Value: paste the token.

**Least clicks:** every **push to `main`** starts an iOS **`production`** build (TestFlight-ready). You don’t have to open Actions unless you want a manual run. Add **`[skip-eas]`** to the commit message only when you want to **skip** the build (e.g. docs-only). **Do not** put `[skip-eas]` in commit messages that explain this feature, or the workflow will skip. If the **`eas-build`** environment requires approval, approve once in GitHub when the workflow is waiting.

Optional: **Actions → EAS iOS build → Run workflow** to pick **production**, **production_xcode26**, or **preview** without pushing.

## Automatic TestFlight submit (no manual `eas submit`)

The **GitHub Actions** workflow passes **`--auto-submit`** for **`production`** and **`production_xcode26`**. When EAS finishes building, it **queues submission to App Store Connect** (TestFlight-by-default for iOS — not public App Store review). You do **not** need to copy Expo’s “run `eas submit`” line after each build.

**Requirements (one-time on Expo):** [`eas credentials`](https://docs.expo.dev/submit/ios/#submitting-your-app-using-cicd-services) must include an **App Store Connect API key** (or other non-interactive Apple auth) so **`eas submit`** can run unattended. If auto-submit fails on the **Submissions** tab in Expo, complete that setup and re-run.

The **`preview`** profile does **not** add **`--auto-submit`** (internal-only distribution).

## WSL (local fallback)

```bash
cd /mnt/c/path/to/bleapp
npx eas-cli@latest build --platform ios --profile preview --non-interactive
```

(Log in once with `npx eas-cli login` or set `EXPO_TOKEN`.)

## Local Windows

`.\eas-build-windows.ps1` points `%TEMP%` to `C:\eas-cli-staging\tmp`. If upload still fails with `EPERM`, use **GitHub Actions** or **WSL** — do not rely on PowerShell alone.

If **`eas credentials` / `eas submit` / `expo config`** errors with **`Cannot find module '@expo/config-plugins'`**, run **`git pull`**, then **`npm install`** from a **short path** outside Google Drive (e.g. `C:\dev\bleapp`) or fix `EPERM`; the config plugin also resolves `@expo/config-plugins` from **`expo`’s nested `node_modules`** when the root install is incomplete.

## Local anywhere

```bash
npm run eas:ios
```

Requires `eas-cli` and `npx eas login` (or `EXPO_TOKEN` in the environment).

## Xcode / iOS SDK (App Store)

Apple currently requires the **iOS 18 SDK** ( **Xcode 16+** ) for uploads. This repo now uses **`macos-sequoia-15.6-xcode-26.2`** for `production` and `production_xcode26` so future submissions are ready for Apple’s upcoming Xcode 26 requirement.

## TestFlight (App Store distribution)

Use the **`production`** or **`production_xcode26`** EAS profile — **`preview`** is internal-only and does not target TestFlight.

1. **Commit and push** `bleapp` (including `app.json` version / `eas.json`).
2. **GitHub:** Actions → **EAS iOS build** → **Run workflow** → profile **`production`** (default) or **`production_xcode26`** (same image, kept for clarity).
3. Wait for the build on [expo.dev](https://expo.dev) → project **ballast-monitor** → Builds. When it succeeds, submit the build to Apple:
   - **Option A:** Expo dashboard → the finished build → **Submit to App Store** (follow prompts), or
   - **Option B (CLI):** from a machine where `eas submit` works (often macOS/Linux or WSL):  
     `npx eas-cli@latest submit --platform ios --latest --profile production_xcode26`  
     Apple / ASC credentials must already be configured for the project (`eas credentials` or prior dashboard submit).
4. **App Store Connect** → your app → **TestFlight**: wait for processing (often 5–30+ minutes), then add testers or enable internal testing.

`npm run eas:submit:ios:next` runs the same submit command as Option B for `production_xcode26` (non-interactive; requires credentials on file).

## Apple Watch + EAS — one interactive run (required once)

GitHub Actions uses **`eas build --non-interactive`**. Apple and Expo need a **human in the loop the first time** you add a second native target (Watch) with a **new bundle id**.

This project has two iOS-related targets:

- **BallastMonitor** — `com.joelevy.ballastmonitor`
- **BallastWatch Watch App** — `com.joelevy.ballastmonitor.watchkitapp`

EAS must create (or confirm) **separate provisioning profiles** for each. Until that’s done on Expo’s side, **CI will keep failing** with messages like *“Credentials are not set up. Run this command again in interactive mode”* — that is expected, not a bug in the repo.

**Do this once** on any machine where you can sign in to **Expo** and (when prompted) **Apple** (your Mac, WSL, or Linux; avoid the Windows Google-Drive path if `npm` still throws `EPERM`):

```bash
cd bleapp
npx eas-cli login
npx eas-cli build --platform ios --profile production
```

- **Do not** pass `--non-interactive` for this run. When the CLI asks, let it set up or fix **credentials** for **both** targets.
- After one **successful** build on [expo.dev](https://expo.dev), your **production** profile and “remote iOS credentials” on Expo are complete; **GitHub Actions** can then use non-interactive builds without you re-pasting errors.

Alternative: `npx eas-cli credentials --platform ios` and follow prompts for each target until both bundle ids show valid profiles.

**Credits:** Expo warned that monthly included credits are used — extra builds bill pay-as-you-go until the cycle resets; see billing under your Expo account settings.

## Troubleshooting failed Actions runs

1. **Summary tab:** Open the workflow run → scroll to **Summary**. Failed **`eas build`** steps append the **last 120 lines** of the Expo CLI log so you do not need to download raw logs for the usual error message.

2. **`Verify Expo authentication` fails:** [`EXPO_TOKEN`](https://expo.dev/account/settings/access-tokens) is missing, expired, or was pasted incorrectly into GitHub (**Settings → Secrets → Actions**). Regenerate the token and save the secret again.

3. **`eas build` fails right away with credentials / provisioning:** CI uses **`--non-interactive`**. Apple signing credentials must already exist on Expo for this project (same account as `extra.eas.projectId` in `app.json`). Configure once locally or from a machine with Expo login:  
   `npx eas-cli credentials`  
   or complete setup in the [Expo dashboard](https://expo.dev) for project **ballast-monitor**.

4. **`gh auth login` vs Expo:** GitHub CLI auth only affects **`gh`** commands (e.g. `gh run view --log-failed`). It does **not** change **`EXPO_TOKEN`** or Expo builds — keep both configured separately.

5. **GitHub integration in Cursor:** Connecting GitHub in [cursor.com/dashboard/integrations](https://cursor.com/dashboard/integrations) enables Cursor product features (e.g. Bugbot); it does **not** replace **`EXPO_TOKEN`** or fix EAS by itself.

6. **`pod install`: `[Xcodeproj] Unable to find compatibility version string for object version '70'`** — Xcode 26 can emit **`objectVersion = 70`**, which **CocoaPods 1.16.x / `xcodeproj` 1.27.0** on EAS does not map yet. This repo pins **`project.pbxproj`** to **`objectVersion = 77`**, which parses correctly and builds. After re-running **prebuild** on a future Mac, re-check this line before committing.

7. **`expo doctor` recommends adding `/ios` to `.easignore`.** Ignore that suggestion here: **`ios/`** is intentionally committed so the Watch companion is built—**never** `.easignore` it for this setup. Expo will not overwrite `orientation` / **icons / plugins** while `ios/` exists; update native files manually when changing those (`app.json` + Xcode).
