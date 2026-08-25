const YOUTUBE_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID || "";
const YOUTUBE_HANDLE = process.env.YOUTUBE_HANDLE || "@2ryoo-world";
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || "";
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";
const CRON_SECRET = process.env.CRON_SECRET || "";
const LOOKBACK_MINUTES = Number(process.env.YOUTUBE_LIVE_LOOKBACK_MINUTES || 10);

const notifiedVideos = new Set();

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

async function findLiveVideo(channelId) {
  const params = new URLSearchParams({
    part: "id",
    channelId,
    eventType: "live",
    type: "video",
    maxResults: "1",
    key: YOUTUBE_API_KEY,
  });
  const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (!response.ok) {
    return { ok: false, error: "youtube_search_failed", status: response.status, detail: await response.text() };
  }

  const data = await response.json();
  const item = data.items && data.items[0];
  if (!item?.id?.videoId) return { ok: true, live: null };

  return { ok: true, videoId: item.id.videoId };
}

async function getVideoLiveInfo(videoId) {
  const params = new URLSearchParams({
    part: "snippet,liveStreamingDetails",
    id: videoId,
    key: YOUTUBE_API_KEY,
  });
  const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`);
  if (!response.ok) {
    return { ok: false, error: "youtube_video_failed", status: response.status, detail: await response.text() };
  }

  const data = await response.json();
  const video = data.items && data.items[0];
  if (!video) return { ok: false, error: "video_not_found", videoId };

  const liveDetails = video.liveStreamingDetails || {};
  const actualStartTime = liveDetails.actualStartTime || "";
  const isLive = video.snippet?.liveBroadcastContent === "live" || Boolean(actualStartTime && !liveDetails.actualEndTime);

  return {
    ok: true,
    isLive,
    videoId,
    actualStartTime,
    title: video.snippet?.title || "이류 유튜브 방송",
    channelTitle: video.snippet?.channelTitle || "이류",
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

function isRecentlyStarted(actualStartTime) {
  if (!actualStartTime) return true;

  const startedAt = new Date(actualStartTime).getTime();
  if (!Number.isFinite(startedAt)) return true;

  const ageMs = Date.now() - startedAt;
  return ageMs >= 0 && ageMs <= LOOKBACK_MINUTES * 60 * 1000;
}

async function sendDiscordNotification(video) {
  if (!DISCORD_WEBHOOK_URL) {
    return { ok: false, reason: "missing_discord_webhook_url" };
  }

  const response = await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "이류월드 알림",
      content: `🔴 **${video.channelTitle} 유튜브 방송 시작!**\n${video.title}\n${video.url}`,
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

  if (!YOUTUBE_API_KEY) {
    res.status(500).json({ error: "missing_youtube_api_key" });
    return;
  }

  const channel = await resolveChannelId();
  if (!channel.ok) {
    res.status(500).json({ error: channel.error, detail: channel });
    return;
  }

  const liveSearch = await findLiveVideo(channel.channelId);
  if (!liveSearch.ok) {
    res.status(502).json({ error: liveSearch.error, detail: liveSearch });
    return;
  }
  if (!liveSearch.videoId) {
    res.status(200).json({ ok: true, live: false, channelId: channel.channelId });
    return;
  }

  const liveInfo = await getVideoLiveInfo(liveSearch.videoId);
  if (!liveInfo.ok || !liveInfo.isLive) {
    res.status(200).json({ ok: true, live: false, skipped: liveInfo.error || "not_live", detail: liveInfo });
    return;
  }

  if (notifiedVideos.has(liveInfo.videoId)) {
    res.status(200).json({ ok: true, live: true, notified: false, skipped: "already_notified_in_this_runtime", videoId: liveInfo.videoId });
    return;
  }

  if (!isRecentlyStarted(liveInfo.actualStartTime)) {
    res.status(200).json({
      ok: true,
      live: true,
      notified: false,
      skipped: "live_started_before_lookback_window",
      videoId: liveInfo.videoId,
      actualStartTime: liveInfo.actualStartTime,
      lookbackMinutes: LOOKBACK_MINUTES,
    });
    return;
  }

  const notification = await sendDiscordNotification(liveInfo);
  if (notification.ok) notifiedVideos.add(liveInfo.videoId);

  res.status(notification.ok ? 200 : 502).json({
    ok: notification.ok,
    live: true,
    notified: notification.ok,
    videoId: liveInfo.videoId,
    actualStartTime: liveInfo.actualStartTime,
    detail: notification,
  });
};
