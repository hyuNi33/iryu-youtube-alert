const crypto = require("crypto");

const HUB_VERIFY_TOKEN = process.env.YOUTUBE_WEBHOOK_VERIFY_TOKEN || "";
const WEBHOOK_SECRET = process.env.YOUTUBE_WEBHOOK_SECRET || "";
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || "";
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";
const CHZZK_CHANNEL_ID = process.env.CHZZK_CHANNEL_ID || "99531be476128737ccd1a1438934ebfd";
const CHECK_CHZZK_ON_YOUTUBE_LIVE = process.env.CHECK_CHZZK_ON_YOUTUBE_LIVE !== "0";

const notifiedVideos = new Set();
const notifiedChzzkLives = new Set();

function getQueryValue(req, key) {
  const url = new URL(req.url, "https://local.invalid");
  return url.searchParams.get(key);
}

async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body, "utf8");

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function verifySignature(req, rawBody) {
  if (!WEBHOOK_SECRET) return true;

  const signature = req.headers["x-hub-signature"] || "";
  const expected = `sha1=${crypto.createHmac("sha1", WEBHOOK_SECRET).update(rawBody).digest("hex")}`;
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  return signatureBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
}

function extractVideoIds(xml) {
  return [...xml.matchAll(/<yt:videoId>([^<]+)<\/yt:videoId>/g)].map((match) => match[1]);
}

async function getVideoLiveInfo(videoId) {
  if (!YOUTUBE_API_KEY) {
    return { ok: false, reason: "missing_youtube_api_key" };
  }

  const params = new URLSearchParams({
    part: "snippet,liveStreamingDetails",
    id: videoId,
    key: YOUTUBE_API_KEY,
  });
  const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`);
  if (!response.ok) {
    return { ok: false, reason: "youtube_api_failed", status: response.status };
  }

  const data = await response.json();
  const video = data.items && data.items[0];
  if (!video) return { ok: false, reason: "video_not_found" };

  const liveDetails = video.liveStreamingDetails || {};
  const isLive = video.snippet?.liveBroadcastContent === "live" || Boolean(liveDetails.actualStartTime && !liveDetails.actualEndTime);

  return {
    ok: true,
    isLive,
    title: video.snippet?.title || "이류 유튜브 방송",
    channelTitle: video.snippet?.channelTitle || "이류",
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

async function getChzzkLiveInfo() {
  const response = await fetch(`https://api.chzzk.naver.com/service/v2/channels/${CHZZK_CHANNEL_ID}/live-detail`, {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0 iryu-live-alert/1.0",
    },
  });

  if (!response.ok) {
    return { ok: false, reason: "chzzk_api_failed", status: response.status, detail: await response.text() };
  }

  const data = await response.json();
  if (data.code && data.code !== 200) {
    return { ok: false, reason: "chzzk_api_error", code: data.code, message: data.message, detail: data };
  }

  const live = data.content;
  if (!live || live.status !== "OPEN") {
    return { ok: true, isLive: false, status: live?.status || "CLOSE" };
  }

  return {
    ok: true,
    isLive: true,
    liveId: String(live.liveId || live.liveNo || ""),
    title: live.liveTitle || "이류 치지직 방송",
    channelName: live.channel?.channelName || live.channelName || "이류",
    category: live.liveCategoryValue || live.liveCategory || "",
    url: `https://chzzk.naver.com/${CHZZK_CHANNEL_ID}`,
  };
}

async function sendDiscordMessage(content) {
  if (!DISCORD_WEBHOOK_URL) {
    return { ok: false, reason: "missing_discord_webhook_url" };
  }

  const response = await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "이류월드 알림",
      content,
      allowed_mentions: { parse: [] },
    }),
  });

  if (!response.ok) {
    return { ok: false, reason: "discord_webhook_failed", status: response.status, detail: await response.text() };
  }

  return { ok: true };
}

async function notifyYoutubeLive(video) {
  return sendDiscordMessage(`🔴 **${video.channelTitle} 유튜브 방송 시작!**\n${video.title}\n${video.url}`);
}

async function notifyChzzkIfLive() {
  if (!CHECK_CHZZK_ON_YOUTUBE_LIVE) {
    return { ok: true, skipped: "disabled" };
  }

  const liveInfo = await getChzzkLiveInfo();
  if (!liveInfo.ok) return liveInfo;
  if (!liveInfo.isLive) return { ok: true, live: false, status: liveInfo.status };

  if (liveInfo.liveId && notifiedChzzkLives.has(liveInfo.liveId)) {
    return { ok: true, live: true, notified: false, skipped: "already_notified_in_this_runtime", liveId: liveInfo.liveId };
  }

  const lines = [`🟢 **${liveInfo.channelName} 치지직 방송 시작!**`, liveInfo.title];
  if (liveInfo.category) lines.push(`카테고리: ${liveInfo.category}`);
  lines.push(liveInfo.url);

  const notification = await sendDiscordMessage(lines.join("\n"));
  if (notification.ok && liveInfo.liveId) notifiedChzzkLives.add(liveInfo.liveId);

  return {
    ok: notification.ok,
    live: true,
    notified: notification.ok,
    liveId: liveInfo.liveId,
    title: liveInfo.title,
    detail: notification,
  };
}

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    const mode = getQueryValue(req, "hub.mode");
    const challenge = getQueryValue(req, "hub.challenge");
    const token = getQueryValue(req, "hub.verify_token");

    if ((mode === "subscribe" || mode === "unsubscribe") && challenge && (!HUB_VERIFY_TOKEN || token === HUB_VERIFY_TOKEN)) {
      res.status(200).send(challenge);
      return;
    }

    res.status(403).json({ error: "invalid_websub_verification" });
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("allow", "GET, POST");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const rawBody = await readRawBody(req);
  if (!verifySignature(req, rawBody)) {
    res.status(401).json({ error: "invalid_signature" });
    return;
  }

  const videoIds = extractVideoIds(rawBody.toString("utf8"));
  const results = [];

  for (const videoId of videoIds) {
    if (notifiedVideos.has(videoId)) {
      results.push({ videoId, skipped: "already_notified_in_this_runtime" });
      continue;
    }

    const liveInfo = await getVideoLiveInfo(videoId);
    if (!liveInfo.ok || !liveInfo.isLive) {
      results.push({ videoId, skipped: liveInfo.reason || "not_live" });
      continue;
    }

    const notification = await notifyYoutubeLive(liveInfo);
    const chzzk = notification.ok ? await notifyChzzkIfLive() : { skipped: "youtube_notification_failed" };
    if (notification.ok) notifiedVideos.add(videoId);
    results.push({ videoId, notified: notification.ok, detail: notification, chzzk });
  }

  res.status(200).json({ ok: true, received: videoIds.length, results });
};
