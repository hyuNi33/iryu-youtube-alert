const CHZZK_CHANNEL_ID = process.env.CHZZK_CHANNEL_ID || "99531be476128737ccd1a1438934ebfd";
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";
const CHECK_TOKEN = process.env.CHZZK_CHECK_TOKEN || process.env.CRON_SECRET || "";
const KV_REST_API_URL = process.env.KV_REST_API_URL || "";
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN || "";

let lastRuntimeLiveId = "";

function getQuery(req) {
  return new URL(req.url, "https://local.invalid").searchParams;
}

function getRequestToken(req) {
  const query = getQuery(req);
  return req.headers["x-chzzk-token"] || req.headers.authorization?.replace(/^Bearer\s+/i, "") || query.get("token") || "";
}

async function kvGet(key) {
  if (!KV_REST_API_URL || !KV_REST_API_TOKEN) return null;

  const response = await fetch(`${KV_REST_API_URL}/get/${encodeURIComponent(key)}`, {
    headers: { authorization: `Bearer ${KV_REST_API_TOKEN}` },
  });
  if (!response.ok) return null;

  const data = await response.json();
  return data.result || null;
}

async function kvSet(key, value) {
  if (!KV_REST_API_URL || !KV_REST_API_TOKEN) return false;

  const response = await fetch(`${KV_REST_API_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`, {
    headers: { authorization: `Bearer ${KV_REST_API_TOKEN}` },
  });
  return response.ok;
}

async function getChzzkLiveInfo() {
  const response = await fetch(`https://api.chzzk.naver.com/service/v2/channels/${CHZZK_CHANNEL_ID}/live-detail`, {
    headers: {
      accept: "application/json, text/plain, */*",
      "accept-language": "ko-KR,ko;q=0.9",
      "front-client-platform-type": "PC",
      "front-client-product-type": "web",
      origin: "https://chzzk.naver.com",
      referer: "https://chzzk.naver.com/",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    return { ok: false, reason: "chzzk_api_failed", status: response.status, detail: await response.text() };
  }

  const data = await response.json();
  if (data.code !== 200 || !data.content) {
    return { ok: false, reason: "chzzk_response_not_ok", detail: data };
  }

  const live = data.content;
  const isLive = live.status === "OPEN";

  return {
    ok: true,
    isLive,
    liveId: String(live.liveId || ""),
    title: live.liveTitle || "이류 치지직 방송",
    channelName: live.channel?.channelName || "이류",
    category: live.liveCategoryValue || live.liveCategory || "",
    openDate: live.openDate || "",
    url: `https://chzzk.naver.com/live/${CHZZK_CHANNEL_ID}`,
  };
}

async function sendDiscordNotification(live, forced) {
  if (!DISCORD_WEBHOOK_URL) {
    return { ok: false, reason: "missing_discord_webhook_url" };
  }

  const lines = [
    forced ? "🧪 **치지직 알림 테스트**" : `🟢 **${live.channelName} 치지직 방송 시작!**`,
    live.title,
  ];

  if (live.category) lines.push(`카테고리: ${live.category}`);
  lines.push(live.url);

  const response = await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "이류월드 알림",
      content: lines.join("\n"),
      allowed_mentions: { parse: [] },
    }),
  });

  if (!response.ok) {
    return { ok: false, reason: "discord_webhook_failed", status: response.status, detail: await response.text() };
  }

  return { ok: true, status: response.status };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("allow", "GET, POST");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  if (!CHECK_TOKEN || getRequestToken(req) !== CHECK_TOKEN) {
    res.status(401).json({ error: "invalid_chzzk_check_token" });
    return;
  }

  const query = getQuery(req);
  const forceNotify = query.get("force") === "1";
  const liveInfo = await getChzzkLiveInfo();

  if (!liveInfo.ok) {
    res.status(502).json({ ok: false, detail: liveInfo });
    return;
  }

  if (!liveInfo.isLive) {
    res.status(200).json({ ok: true, live: false, title: liveInfo.title });
    return;
  }

  const stateKey = `chzzk:last-live-id:${CHZZK_CHANNEL_ID}`;
  const lastPersistedLiveId = await kvGet(stateKey);
  const alreadyNotified = !forceNotify && liveInfo.liveId && (liveInfo.liveId === lastPersistedLiveId || liveInfo.liveId === lastRuntimeLiveId);

  if (alreadyNotified) {
    res.status(200).json({ ok: true, live: true, notified: false, skipped: "already_notified", liveId: liveInfo.liveId, title: liveInfo.title });
    return;
  }

  const notification = await sendDiscordNotification(liveInfo, forceNotify);
  if (!notification.ok) {
    res.status(502).json({ ok: false, live: true, notified: false, detail: notification });
    return;
  }

  if (!forceNotify && liveInfo.liveId) {
    lastRuntimeLiveId = liveInfo.liveId;
    await kvSet(stateKey, liveInfo.liveId);
  }

  res.status(200).json({ ok: true, live: true, notified: true, liveId: liveInfo.liveId, title: liveInfo.title, notification });
};
