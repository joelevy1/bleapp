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

## WSL (local fallback)

```bash
cd /mnt/c/path/to/bleapp
npx eas-cli@latest build --platform ios --profile preview --non-interactive
```

(Log in once with `npx eas-cli login` or set `EXPO_TOKEN`.)

## Local Windows

`.\eas-build-windows.ps1` points `%TEMP%` to `C:\eas-cli-staging\tmp`. If upload still fails with `EPERM`, use **GitHub Actions** or **WSL** — do not rely on PowerShell alone.

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
