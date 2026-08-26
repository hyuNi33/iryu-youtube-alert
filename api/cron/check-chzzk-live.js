const CHZZK_CHANNEL_ID = process.env.CHZZK_CHANNEL_ID || "";
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";
const CRON_SECRET = process.env.CRON_SECRET || "";
const LOOKBACK_MINUTES = Number(process.env.CHZZK_LIVE_LOOKBACK_MINUTES || 15);

const notifiedLives = new Set();

async function getChzzkLiveInfo() {
  if (!CHZZK_CHANNEL_ID) {
    return { ok: false, error: "missing_chzzk_channel_id" };
  }

  const response = await fetch(`https://api.chzzk.naver.com/service/v2/channels/${CHZZK_CHANNEL_ID}/live-detail`, {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0 iryu-live-alert/1.0",
    },
  });

  if (!response.ok) {
    return { ok: false, error: "chzzk_api_failed", status: response.status, detail: await response.text() };
  }

  const data = await response.json();
  if (data.code && data.code !== 200) {
    return { ok: false, error: "chzzk_api_error", code: data.code, message: data.message, detail: data };
  }

  const live = data.content;
  if (!live || live.status !== "OPEN") {
    return { ok: true, live: false, status: live?.status || "CLOSE" };
  }

  const liveId = String(live.liveId || live.liveNo || "");
  return {
    ok: true,
    live: true,
    liveId,
    title: live.liveTitle || "이류 치지직 방송",
    channelName: live.channel?.channelName || live.channelName || "이류",
    openDate: live.openDate || live.liveOpenDate || "",
    url: `https://chzzk.naver.com/${CHZZK_CHANNEL_ID}`,
  };
}

function isRecentlyStarted(openDate) {
  if (!openDate) return true;

  const startedAt = new Date(openDate).getTime();
  if (!Number.isFinite(startedAt)) return true;

  const ageMs = Date.now() - startedAt;
  return ageMs >= 0 && ageMs <= LOOKBACK_MINUTES * 60 * 1000;
}

async function sendDiscordNotification(live) {
  if (!DISCORD_WEBHOOK_URL) {
    return { ok: false, reason: "missing_discord_webhook_url" };
  }

  const response = await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "이류월드 알림",
      content: `🟢 **${live.channelName} 치지직 방송 시작!**\n${live.title}\n${live.url}`,
      allowed_mentions: { parse: [] },
    }),
  });

  if (!response.ok) {
    return { ok: false, reason: "discord_webhook_failed", status: response.status, detail: await response.text() };
  }

  return { ok: true };
}

function isAuthorized(req) {
  const url = new URL(req.url, "https://local.invalid");
  const token = url.searchParams.get("token") || "";
  return (CRON_SECRET && req.headers.authorization === `Bearer ${CRON_SECRET}`) || token === CRON_SECRET;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("allow", "GET, POST");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  if (!isAuthorized(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const liveInfo = await getChzzkLiveInfo();
  if (!liveInfo.ok) {
    res.status(liveInfo.status ? 502 : 500).json({ error: liveInfo.error, detail: liveInfo });
    return;
  }

  if (!liveInfo.live) {
    res.status(200).json({ ok: true, live: false, status: liveInfo.status });
    return;
  }

  if (liveInfo.liveId && notifiedLives.has(liveInfo.liveId)) {
    res.status(200).json({ ok: true, live: true, notified: false, skipped: "already_notified_in_this_runtime", liveId: liveInfo.liveId });
    return;
  }

  if (!isRecentlyStarted(liveInfo.openDate)) {
    res.status(200).json({
      ok: true,
      live: true,
      notified: false,
      skipped: "live_started_before_lookback_window",
      liveId: liveInfo.liveId,
      openDate: liveInfo.openDate,
      lookbackMinutes: LOOKBACK_MINUTES,
    });
    return;
  }

  const notification = await sendDiscordNotification(liveInfo);
  if (notification.ok && liveInfo.liveId) notifiedLives.add(liveInfo.liveId);

  res.status(notification.ok ? 200 : 502).json({
    ok: notification.ok,
    live: true,
    notified: notification.ok,
    liveId: liveInfo.liveId,
    openDate: liveInfo.openDate,
    detail: notification,
  });
};
