import { ChannelType } from "discord.js";

const SNOWFLAKE_PATTERN = /\d{16,20}/g;

export function extractSnowflake(value) {
  const text = String(value || "").trim();
  const matches = text.match(SNOWFLAKE_PATTERN) || [];
  return matches.at(-1) || "";
}

export function parseSnowflakeList(value) {
  const text = String(value || "").trim();
  if (!text) {
    return [];
  }

  const matches = text.match(SNOWFLAKE_PATTERN) || [];
  return [...new Set(matches)];
}

export function isTextAnnouncementChannel(channel) {
  return Boolean(channel && [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type));
}

export async function resolveTextAnnouncementChannel(guild, channelId) {
  if (!channelId) {
    return null;
  }

  const channel = guild.channels.cache.get(channelId)
    || (await guild.channels.fetch(channelId).catch(() => null));

  if (!isTextAnnouncementChannel(channel)) {
    return null;
  }

  return channel;
}
