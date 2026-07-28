import { normalizeContentCreatorConfig } from "./config.js";
import {
  fetchLatestYouTubeVideo,
  fetchTwitchStream,
  fetchTwitchUser,
  fetchYouTubeChannel,
  isTwitchConfigured,
  isYouTubeConfigured
} from "./providers.js";

function safeString(value) {
  return String(value ?? "").trim();
}

function toSnowflake(value) {
  const matches = safeString(value).match(/\d{16,20}/g) || [];
  return matches.at(-1) || "";
}

/**
 * Übernimmt eine Creator-Konfiguration aus dem Dashboard.
 * Profile werden gegen die YouTube-/Twitch-API aufgelöst, damit im Dashboard
 * ein Kanalname oder Link genügt. Bereits bekannte Kanäle behalten ihren
 * Fortschritt, damit alte Videos nicht erneut angekündigt werden.
 */
export async function applyCreatorConfig(client, guildId, input) {
  const { settingsStore, env } = client.botContext;
  const currentConfig = normalizeContentCreatorConfig(
    settingsStore.getModuleState(guildId, "content-creator")?.config
  );

  const currentYoutube = new Map(currentConfig.youtubeChannels.map((entry) => [entry.channelId, entry]));
  const currentTwitch = new Map(currentConfig.twitchChannels.map((entry) => [entry.login, entry]));

  const warnings = [];
  const nextYoutube = [];
  const nextTwitch = [];

  const youtubeInput = Array.isArray(input?.youtubeChannels) ? input.youtubeChannels : [];
  const twitchInput = Array.isArray(input?.twitchChannels) ? input.twitchChannels : [];

  if (youtubeInput.length > 0 && !isYouTubeConfigured(env)) {
    warnings.push("YOUTUBE_API_KEY fehlt – YouTube-Kanäle wurden nicht übernommen.");
  } else {
    for (const entry of youtubeInput) {
      const profile = safeString(entry?.profile || entry?.channelId);
      if (!profile) {
        continue;
      }

      const channelInfo = await fetchYouTubeChannel(env, profile).catch(() => null);
      if (!channelInfo) {
        warnings.push(`YouTube-Kanal nicht gefunden: ${profile}`);
        continue;
      }

      const previous = currentYoutube.get(channelInfo.channelId);
      const latest = previous ? null : await fetchLatestYouTubeVideo(env, channelInfo.channelId).catch(() => null);

      nextYoutube.push({
        channelId: channelInfo.channelId,
        channelTitle: channelInfo.title,
        lastVideoId: previous?.lastVideoId || latest?.videoId || "",
        lastPublishedAt: previous?.lastPublishedAt || latest?.publishedAt || "",
        announceTemplate: safeString(entry?.announceTemplate)
      });
    }
  }

  if (twitchInput.length > 0 && !isTwitchConfigured(env)) {
    warnings.push("TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET fehlt – Twitch-Kanäle wurden nicht übernommen.");
  } else {
    for (const entry of twitchInput) {
      const profile = safeString(entry?.profile || entry?.login);
      if (!profile) {
        continue;
      }

      const user = await fetchTwitchUser(env, profile).catch(() => null);
      if (!user) {
        warnings.push(`Twitch-Kanal nicht gefunden: ${profile}`);
        continue;
      }

      const previous = currentTwitch.get(user.login);
      const stream = previous ? null : await fetchTwitchStream(env, user.id).catch(() => null);

      nextTwitch.push({
        login: user.login,
        userId: user.id,
        displayName: user.displayName,
        lastStreamId: previous?.lastStreamId || stream?.streamId || "",
        wasLive: previous ? Boolean(previous.wasLive) : Boolean(stream),
        announceTemplate: safeString(entry?.announceTemplate)
      });
    }
  }

  const nextConfig = {
    notifyChannelId: toSnowflake(input?.notifyChannelId),
    youtubeRoleId: toSnowflake(input?.youtubeRoleId),
    twitchRoleId: toSnowflake(input?.twitchRoleId),
    youtubeChannels: nextYoutube,
    twitchChannels: nextTwitch
  };

  settingsStore.setModuleConfig(guildId, "content-creator", nextConfig);
  return { config: nextConfig, warnings };
}
