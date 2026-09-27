const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { getYoutubeChannelConfig } = require("../lib/youtube-channel");
const channelId = "UCBoJBW0Akc4QrfsEJCtgSGA";

test("default and obsolete handle use the confirmed channel ID", () => {
  for (const handle of [undefined, "", "@2ryoo-world", "2ryoo-world", " @2ryoo-world ", "@이류인생"]) {
    assert.equal(getYoutubeChannelConfig({ YOUTUBE_HANDLE: handle }).YOUTUBE_CHANNEL_ID, channelId);
  }
});

test("explicit channel settings retain priority", () => {
  assert.equal(getYoutubeChannelConfig({ YOUTUBE_CHANNEL_ID: " custom-id " }).YOUTUBE_CHANNEL_ID, "custom-id");
  assert.deepEqual(getYoutubeChannelConfig({ YOUTUBE_HANDLE: "@other" }), {
    YOUTUBE_CHANNEL_ID: "", YOUTUBE_HANDLE: "@other",
  });
});

for (const file of ["api/cron/check-youtube-live.js", "api/cron/subscribe-youtube.js", "api/youtube/subscribe.js"]) {
  test(`${file}: obsolete production handle no longer calls channels.list`, async () => {
    const env = {
      YOUTUBE_HANDLE: "@2ryoo-world", YOUTUBE_API_KEY: "test-key",
      CRON_SECRET: "test-token", YOUTUBE_SUBSCRIBE_TOKEN: "test-token",
      SITE_URL: "https://example.invalid",
    };
    const calls = [];
    const sandbox = {
      module: { exports: {} }, process: { env }, URL, URLSearchParams, Buffer,
      require: () => ({ getYoutubeChannelConfig: () => getYoutubeChannelConfig(env) }),
      fetch: async (url, options) => {
        calls.push(String(url));
        if (String(url).includes("/youtube/v3/search?")) {
          assert.equal(new URL(url).searchParams.get("channelId"), channelId);
          return { ok: true, json: async () => ({ items: [] }) };
        }
        assert.equal(String(url), "https://pubsubhubbub.appspot.com/subscribe");
        const params = new URLSearchParams(options.body);
        assert.equal(params.get("hub.topic"), `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${channelId}`);
        return { ok: true, status: 202, text: async () => "" };
      },
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), sandbox);
    let status;
    let body;
    const res = { status(code) { status = code; return this; }, json(value) { body = value; }, setHeader() {} };
    await sandbox.module.exports({ method: "GET", url: "/?token=test-token", headers: { authorization: "Bearer test-token" } }, res);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(calls.length, 1);
  });
}
