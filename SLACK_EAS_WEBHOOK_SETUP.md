# Slack notifications for EAS builds (with install link + QR)

This adds a webhook endpoint (deployable on Vercel) that:

- verifies `expo-signature` from EAS (HMAC-SHA1)
- posts a Slack message when builds finish
- includes a **direct install/download link** (when available) and a **QR code** for that link

## 1) Create a Slack Incoming Webhook

- In Slack, create an **Incoming Webhook** for the channel you want.
- Copy the webhook URL (looks like `https://hooks.slack.com/services/.../.../...`).

## 2) Deploy the webhook endpoint to Vercel

From this project directory:

```bash
npx vercel
```

After deploy, your endpoint will be:

- `https://<your-vercel-app>.vercel.app/api/eas-webhook`

### Set Vercel environment variables

In Vercel project settings → Environment Variables, add:

- `SLACK_WEBHOOK_URL` = your Slack incoming webhook URL
- `EXPO_WEBHOOK_SECRET` = a long random secret (16+ chars)

Deploy again after setting env vars.

## 3) Create the EAS webhook

Run:

```bash
npx eas-cli webhook:create --event BUILD --url "https://<your-vercel-app>.vercel.app/api/eas-webhook" --secret "<EXPO_WEBHOOK_SECRET>"
```

Notes:
- Use the **same** secret value you set in Vercel.
- This webhook fires for build events (finished/errored/canceled).

## 4) Test it

Kick off a build:

```bash
npx eas-cli build --platform ios --profile preview
```

When it finishes, Slack should receive:
- a link (preferably the artifact URL; falls back to the build details page)
- a QR code image that points at that same link

## iOS “internal” distribution caveat

For `distribution: "internal"` on iOS, the install link works only for devices included in the Ad Hoc provisioning profile.

