import { extractYouTubeChannelId, normalizeTwitchLogin } from "./config.js";

let cachedTwitchToken = {
  value: "",
  expiresAt: 0
};

const YOUTUBE_QUOTA_COOLDOWN_MS = 60 * 60 * 1000;
const youtubeUploadsPlaylistCache = new Map();
let youtubeQuotaBlockedUntil = 0;

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = payload?.error_description || payload?.message || text || response.statusText;
    throw new Error(`${response.status} ${message}`);
  }

  return payload;
}

export function isYouTubeConfigured(env) {
  return Boolean(env.youtubeApiKey);
}

export function isYouTubeQuotaExceededError(error) {
  const text = String(error || "");
  return /quotaExceeded/i.test(text) || /youtube\.quota/i.test(text);
}

export function markYouTubeQuotaExceeded(cooldownMs = YOUTUBE_QUOTA_COOLDOWN_MS) {
  const safeCooldownMs = Number.isFinite(cooldownMs)
    ? Math.max(60_000, Number(cooldownMs))
    : YOUTUBE_QUOTA_COOLDOWN_MS;

  youtubeQuotaBlockedUntil = Math.max(youtubeQuotaBlockedUntil, Date.now() + safeCooldownMs);
}

export function isYouTubeQuotaCoolingDown() {
  return youtubeQuotaBlockedUntil > Date.now();
}

export function getYouTubeQuotaRetryAt() {
  return youtubeQuotaBlockedUntil;
}

export function isTwitchConfigured(env) {
  return Boolean(env.twitchClientId && env.twitchClientSecret);
}

export async function fetchYouTubeChannel(env, channelInput) {
  const normalizedInput = String(channelInput || "").trim();
  let channelId = extractYouTubeChannelId(normalizedInput);

  if (!isYouTubeConfigured(env)) {
    throw new Error("YOUTUBE_API_KEY fehlt");
  }

  if (!channelId) {
    const handle = normalizedInput
      .replace(/^https?:\/\/www\.youtube\.com\//i, "")
      .replace(/^https?:\/\/youtube\.com\//i, "")
      .replace(/^@/, "")
      .split("/")[0]
      .trim();

    if (!handle) {
      return null;
    }

    const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    searchUrl.searchParams.set("part", "snippet");
    searchUrl.searchParams.set("maxResults", "1");
    searchUrl.searchParams.set("type", "channel");
    searchUrl.searchParams.set("q", handle);
    searchUrl.searchParams.set("key", env.youtubeApiKey);

    const searchData = await fetchJson(searchUrl.toString());
    const searchItem = Array.isArray(searchData?.items) ? searchData.items[0] : null;
    const foundId = searchItem?.snippet?.channelId || searchItem?.id?.channelId || "";

    channelId = extractYouTubeChannelId(foundId);
    if (!channelId) {
      return null;
    }
  }

  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("id", channelId);
  url.searchParams.set("key", env.youtubeApiKey);

  const data = await fetchJson(url.toString());
  const item = Array.isArray(data?.items) ? data.items[0] : null;
  if (!item) {
    return null;
  }

  return {
    channelId,
    title: item.snippet?.title || channelId
  };
}

export async function fetchLatestYouTubeVideo(env, channelId) {
  if (!isYouTubeConfigured(env)) {
    throw new Error("YOUTUBE_API_KEY fehlt");
  }

  const normalizedChannelId = extractYouTubeChannelId(channelId);
  if (!normalizedChannelId) {
    return null;
  }

  const cachedUploadsPlaylistId = youtubeUploadsPlaylistCache.get(normalizedChannelId);
  let uploadsPlaylistId = cachedUploadsPlaylistId || "";

  if (!uploadsPlaylistId) {
    const channelUrl = new URL("https://www.googleapis.com/youtube/v3/channels");
    channelUrl.searchParams.set("part", "contentDetails");
    channelUrl.searchParams.set("id", normalizedChannelId);
    channelUrl.searchParams.set("key", env.youtubeApiKey);

    const channelData = await fetchJson(channelUrl.toString());
    const channelItem = Array.isArray(channelData?.items) ? channelData.items[0] : null;
    uploadsPlaylistId = channelItem?.contentDetails?.relatedPlaylists?.uploads || "";

    if (!uploadsPlaylistId) {
      return null;
    }

    youtubeUploadsPlaylistCache.set(normalizedChannelId, uploadsPlaylistId);
  }

  const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
  url.searchParams.set("part", "snippet,contentDetails");
  url.searchParams.set("playlistId", uploadsPlaylistId);
  url.searchParams.set("maxResults", "1");
  url.searchParams.set("key", env.youtubeApiKey);

  const data = await fetchJson(url.toString());
  const item = Array.isArray(data?.items) ? data.items[0] : null;
  const videoId = item?.contentDetails?.videoId || item?.snippet?.resourceId?.videoId || "";

  if (!videoId) {
    return null;
  }

  return {
    videoId,
    title: item.snippet?.title || "Neues Video",
    publishedAt: item?.contentDetails?.videoPublishedAt || item.snippet?.publishedAt || "",
    channelTitle: item.snippet?.channelTitle || normalizedChannelId,
    url: `https://www.youtube.com/watch?v=${videoId}`
  };
}

async function getTwitchAccessToken(env) {
  const now = Date.now();
  if (cachedTwitchToken.value && cachedTwitchToken.expiresAt > now + 10_000) {
    return cachedTwitchToken.value;
  }

  const body = new URLSearchParams({
    client_id: env.twitchClientId,
    client_secret: env.twitchClientSecret,
    grant_type: "client_credentials"
  });

  const data = await fetchJson("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });

  const token = data?.access_token || "";
  const expiresIn = Number(data?.expires_in || 0);

  if (!token || !expiresIn) {
    throw new Error("Twitch Token konnte nicht geladen werden");
  }

  cachedTwitchToken = {
    value: token,
    expiresAt: now + expiresIn * 1000
  };

  return token;
}

async function fetchTwitchHelix(env, path, params = {}) {
  if (!isTwitchConfigured(env)) {
    throw new Error("TWITCH_CLIENT_ID oder TWITCH_CLIENT_SECRET fehlt");
  }

  const token = await getTwitchAccessToken(env);
  const url = new URL(`https://api.twitch.tv/helix/${path}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value) !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  return fetchJson(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      "Client-Id": env.twitchClientId
    }
  });
}

export async function fetchTwitchUser(env, loginInput) {
  const login = normalizeTwitchLogin(loginInput);
  if (!login) {
    return null;
  }

  const data = await fetchTwitchHelix(env, "users", { login });
  const item = Array.isArray(data?.data) ? data.data[0] : null;
  if (!item) {
    return null;
  }

  return {
    id: item.id,
    login: item.login,
    displayName: item.display_name || item.login
  };
}

export async function fetchTwitchStream(env, userId) {
  if (!userId) {
    return null;
  }

  const data = await fetchTwitchHelix(env, "streams", { user_id: userId });
  const item = Array.isArray(data?.data) ? data.data[0] : null;

  if (!item) {
    return null;
  }

  const userLogin = item.user_login || item.user_name || "";
  const previewImageUrl = String(item.thumbnail_url || "")
    .replace("{width}", "1280")
    .replace("{height}", "720");

  return {
    streamId: item.id,
    userId: item.user_id,
    userName: item.user_name,
    userLogin,
    title: item.title || "Live",
    gameName: item.game_name || "",
    viewerCount: Number(item.viewer_count || 0),
    startedAt: item.started_at || "",
    previewImageUrl,
    url: `https://twitch.tv/${userLogin}`
  };
}
