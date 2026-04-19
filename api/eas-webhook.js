const crypto = require('crypto');

function timingSafeEqual(a, b) {
  const aBuf = Buffer.from(String(a || ''), 'utf8');
  const bBuf = Buffer.from(String(b || ''), 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function getQrUrl(dataUrl) {
  // Simple hosted QR generator (no auth). Slack will render the image.
  const encoded = encodeURIComponent(dataUrl);
  return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encoded}`;
}

function slackPayload({ title, text, url, qrUrl }) {
  // Slack Incoming Webhook payload
  return {
    text: `${title}\n${text}\n${url}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: title, emoji: true } },
      { type: 'section', text: { type: 'mrkdwn', text } },
      ...(url
        ? [{ type: 'section', text: { type: 'mrkdwn', text: `• Install/link: ${url}` } }]
        : []),
      ...(qrUrl
        ? [{ type: 'image', image_url: qrUrl, alt_text: 'Install QR code' }]
        : []),
      { type: 'context', elements: [{ type: 'mrkdwn', text: 'Sent by EAS Build webhook' }] },
    ],
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    res.end('Method not allowed');
    return;
  }

  const rawBody = await readRawBody(req);
  const expoSignature = req.headers['expo-signature'];
  const secret = process.env.EXPO_WEBHOOK_SECRET;
  const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!secret) {
    res.statusCode = 500;
    res.end('Missing EXPO_WEBHOOK_SECRET');
    return;
  }
  if (!slackWebhookUrl) {
    res.statusCode = 500;
    res.end('Missing SLACK_WEBHOOK_URL');
    return;
  }

  // Verify request signature (EAS: hex HMAC-SHA1 digest)
  const hmac = crypto.createHmac('sha1', secret);
  hmac.update(rawBody);
  const expected = `sha1=${hmac.digest('hex')}`;
  if (!timingSafeEqual(expoSignature, expected)) {
    res.statusCode = 401;
    res.end('Invalid signature');
    return;
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    res.statusCode = 400;
    res.end('Invalid JSON');
    return;
  }

  const status = payload?.status;
  const platform = payload?.platform;
  const buildUrl = payload?.artifacts?.buildUrl;
  const detailsUrl = payload?.buildDetailsPageUrl;
  const profile = payload?.metadata?.buildProfile;
  const distribution = payload?.metadata?.distribution;
  const appIdentifier = payload?.metadata?.appIdentifier;
  const appVersion = payload?.metadata?.appVersion;
  const appBuildVersion = payload?.metadata?.appBuildVersion;

  const title = `EAS Build ${status || 'update'} (${platform || 'unknown'})`;
  const lines = [
    profile ? `*Profile*: \`${profile}\`` : null,
    distribution ? `*Distribution*: \`${distribution}\`` : null,
    appIdentifier ? `*Bundle*: \`${appIdentifier}\`` : null,
    appVersion ? `*Version*: \`${appVersion}\`` : null,
    appBuildVersion ? `*Build*: \`${appBuildVersion}\`` : null,
    detailsUrl ? `*Details*: ${detailsUrl}` : null,
  ].filter(Boolean);

  const text = lines.join('\n');
  const urlToShare = buildUrl || detailsUrl || '';
  const qrUrl = urlToShare ? getQrUrl(urlToShare) : null;

  try {
    const r = await fetch(slackWebhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(slackPayload({ title, text, url: urlToShare, qrUrl })),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      res.statusCode = 502;
      res.end(`Slack webhook failed: ${r.status} ${body}`);
      return;
    }
  } catch (e) {
    res.statusCode = 502;
    res.end(`Slack webhook error: ${e?.message || String(e)}`);
    return;
  }

  res.statusCode = 200;
  res.end('OK');
};

// Vercel: disable default body parsing so we can verify signature on raw payload.
module.exports.config = {
  api: {
    bodyParser: false,
  },
};

