const YOUTUBE_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID || "";
const YOUTUBE_HANDLE = process.env.YOUTUBE_HANDLE || "@2ryoo-world";
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || "";
const YOUTUBE_CALLBACK_URL = process.env.YOUTUBE_CALLBACK_URL || "";
const SITE_URL = process.env.SITE_URL || "";
const WEBHOOK_SECRET = process.env.YOUTUBE_WEBHOOK_SECRET || "";
const VERIFY_TOKEN = process.env.YOUTUBE_WEBHOOK_VERIFY_TOKEN || "";
const SUBSCRIBE_TOKEN = process.env.YOUTUBE_SUBSCRIBE_TOKEN || "";

function getRequestToken(req) {
  const url = new URL(req.url, "https://local.invalid");
  return req.headers["x-subscribe-token"] || url.searchParams.get("token") || "";
}

function getCallbackUrl() {
  if (YOUTUBE_CALLBACK_URL) return YOUTUBE_CALLBACK_URL;
  if (SITE_URL) return `${SITE_URL.replace(/\/$/, "")}/api/youtube/webhook`;
  return "";
}

async function resolveChannelId() {
  if (YOUTUBE_CHANNEL_ID) {
    return { ok: true, channelId: YOUTUBE_CHANNEL_ID, source: "YOUTUBE_CHANNEL_ID" };
  }

  if (!YOUTUBE_API_KEY || !YOUTUBE_HANDLE) {
    return { ok: false, error: "missing_channel_env" };
  }

  const params = new URLSearchParams({
    part: "id,snippet",
    forHandle: YOUTUBE_HANDLE,
    key: YOUTUBE_API_KEY,
  });
  const response = await fetch(`https://www.googleapis.com/youtube/v3/channels?${params}`);
  if (!response.ok) {
    return { ok: false, error: "channel_resolve_failed", status: response.status, detail: await response.text() };
  }

  const data = await response.json();
  const channel = data.items && data.items[0];
  if (!channel) {
    return { ok: false, error: "channel_not_found", handle: YOUTUBE_HANDLE };
  }

  return {
    ok: true,
    channelId: channel.id,
    channelTitle: channel.snippet?.title || "",
    handle: YOUTUBE_HANDLE,
    source: "YOUTUBE_HANDLE",
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("allow", "GET, POST");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  if (!SUBSCRIBE_TOKEN || getRequestToken(req) !== SUBSCRIBE_TOKEN) {
    res.status(401).json({ error: "invalid_subscribe_token" });
    return;
  }

  const callbackUrl = getCallbackUrl();
  if (!callbackUrl) {
    res.status(500).json({ error: "missing_env", required: ["SITE_URL or YOUTUBE_CALLBACK_URL"] });
    return;
  }

  const channel = await resolveChannelId();
  if (!channel.ok) {
    res.status(500).json({ error: channel.error, detail: channel });
    return;
  }

  const body = new URLSearchParams({
    "hub.callback": callbackUrl,
    "hub.topic": `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${channel.channelId}`,
    "hub.mode": "subscribe",
    "hub.verify": "async",
    "hub.lease_seconds": "432000",
  });

  if (WEBHOOK_SECRET) body.set("hub.secret", WEBHOOK_SECRET);
  if (VERIFY_TOKEN) body.set("hub.verify_token", VERIFY_TOKEN);

  const response = await fetch("https://pubsubhubbub.appspot.com/subscribe", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  res.status(response.ok ? 200 : 502).json({
    ok: response.ok,
    status: response.status,
    callbackUrl,
    channelId: channel.channelId,
    channelTitle: channel.channelTitle,
    handle: channel.handle,
    source: channel.source,
    detail: await response.text(),
  });
};
