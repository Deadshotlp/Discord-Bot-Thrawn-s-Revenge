function safeString(value) {
  return String(value || "").trim();
}

function toSnowflake(value) {
  const text = safeString(value);
  if (!text) {
    return "";
  }

  const matches = text.match(/\d{16,20}/g) || [];
  return matches.at(-1) || "";
}

export function normalizeTwitchLogin(value) {
  const text = safeString(value)
    .toLowerCase()
    .replace(/^https?:\/\/www\.twitch\.tv\//, "")
    .replace(/^https?:\/\/twitch\.tv\//, "")
    .replace(/^@/, "")
    .split("/")[0]
    .trim();

  return text.replace(/[^a-z0-9_]/g, "").slice(0, 25);
}

export function extractYouTubeChannelId(value) {
  const text = safeString(value);
  if (!text) {
    return "";
  }

  const direct = text.match(/(UC[\w-]{22})/);
  if (direct) {
    return direct[1];
  }

  return "";
}

export function normalizeYouTubeChannels(raw) {
  const source = Array.isArray(raw) ? raw : [];
  const unique = new Map();

  for (const entry of source) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const channelId = extractYouTubeChannelId(entry.channelId);
    if (!channelId) {
      continue;
    }

    unique.set(channelId, {
      channelId,
      channelTitle: safeString(entry.channelTitle),
      lastVideoId: safeString(entry.lastVideoId),
      lastPublishedAt: safeString(entry.lastPublishedAt),
      announceTemplate: safeString(entry.announceTemplate)
    });
  }

  return Array.from(unique.values());
}

export function normalizeTwitchChannels(raw) {
  const source = Array.isArray(raw) ? raw : [];
  const unique = new Map();

  for (const entry of source) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const login = normalizeTwitchLogin(entry.login);
    if (!login) {
      continue;
    }

    unique.set(login, {
      login,
      userId: safeString(entry.userId),
      displayName: safeString(entry.displayName),
      lastStreamId: safeString(entry.lastStreamId),
      wasLive: Boolean(entry.wasLive),
      announceTemplate: safeString(entry.announceTemplate)
    });
  }

  return Array.from(unique.values());
}

export function normalizeContentCreatorConfig(rawConfig) {
  const config = rawConfig && typeof rawConfig === "object" ? rawConfig : {};

  return {
    notifyChannelId: toSnowflake(config.notifyChannelId),
    youtubeChannels: normalizeYouTubeChannels(config.youtubeChannels),
    twitchChannels: normalizeTwitchChannels(config.twitchChannels)
  };
}
