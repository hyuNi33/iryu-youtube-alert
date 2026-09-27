// Keep the channel stable even when its public handle changes.
const DEFAULT_CHANNEL_ID = "UCBoJBW0Akc4QrfsEJCtgSGA";
const DEFAULT_HANDLE = "@이류인생";

function getYoutubeChannelConfig(env = process.env) {
  const handle = (env.YOUTUBE_HANDLE || "").trim() || DEFAULT_HANDLE;
  const normalizedHandle = handle.replace(/^@/, "").toLowerCase();
  const isDefaultChannel = ["이류인생", "2ryoo-world"].includes(normalizedHandle);
  return {
    YOUTUBE_CHANNEL_ID: (env.YOUTUBE_CHANNEL_ID || "").trim() || (isDefaultChannel ? DEFAULT_CHANNEL_ID : ""),
    YOUTUBE_HANDLE: isDefaultChannel ? DEFAULT_HANDLE : handle,
  };
}

module.exports = { getYoutubeChannelConfig };
