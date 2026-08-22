const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";
const TEST_TOKEN = process.env.YOUTUBE_SUBSCRIBE_TOKEN || "";

function getRequestToken(req) {
  const url = new URL(req.url, "https://local.invalid");
  return req.headers["x-test-token"] || url.searchParams.get("token") || "";
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("allow", "GET, POST");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  if (!TEST_TOKEN || getRequestToken(req) !== TEST_TOKEN) {
    res.status(401).json({ error: "invalid_test_token" });
    return;
  }

  if (!DISCORD_WEBHOOK_URL) {
    res.status(500).json({ error: "missing_discord_webhook_url" });
    return;
  }

  const response = await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "이류월드 알림",
      content: "✅ 유튜브 방송 알림 테스트입니다. 이 메시지가 보이면 Discord 웹훅 연결은 정상입니다.",
      allowed_mentions: { parse: [] },
    }),
  });

  res.status(response.ok ? 200 : 502).json({
    ok: response.ok,
    status: response.status,
    detail: await response.text(),
  });
};
