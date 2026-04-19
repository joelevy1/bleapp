# EAS build automation

Use **GitHub Actions** so builds are submitted from **Linux** (reliable). Local `eas build` on Windows often fails during upload with `EPERM` / `rmdir` under `%TEMP%` (Google Drive, antivirus, or eas-cli cleanup); **WSL** is the best local fallback.

## GitHub Actions (recommended)

Builds run on **Ubuntu**, so the Windows `EPERM` / `rmdir` issue during upload does not occur.

1. Create an Expo access token: **https://expo.dev/accounts/&lt;you&gt;/settings/access-tokens** (scope: at least **Build**).
2. In the GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `EXPO_TOKEN`
   - Value: paste the token.
3. Run **Actions → EAS iOS build → Run workflow**, choose **preview** or **production**.

The workflow runs `eas build --platform ios --non-interactive --no-wait` (build continues on Expo; you get a link in the job log).

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
