import { ChannelType } from "discord.js";
import { normalizeContentCreatorConfig } from "./config.js";
import {
  fetchLatestYouTubeVideo,
  fetchTwitchStream,
  isTwitchConfigured,
  isYouTubeConfigured
} from "./providers.js";

const DEFAULT_YOUTUBE_TEMPLATE = "Neues YouTube-Video von {creator}: {title}\n{url}";
const DEFAULT_TWITCH_TEMPLATE = "{creator} ist jetzt LIVE auf Twitch!\n{title}\n{url}";

async function resolveNotifyChannel(guild, channelId) {
  if (!channelId) {
    return null;
  }

  const channel = guild.channels.cache.get(channelId)
    || (await guild.channels.fetch(channelId).catch(() => null));

  if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
    return null;
  }

  return channel;
}

function renderTemplate(template, fallbackTemplate, variables) {
  const activeTemplate = String(template || "").trim() || fallbackTemplate;

  return activeTemplate.replace(/\{(creator|title|url|game|platform)\}/g, (_, key) => {
    const value = variables[key];
    return value ? String(value) : "";
  });
}

function buildYouTubeMessage(source, latestVideo) {
  const content = renderTemplate(source.announceTemplate, DEFAULT_YOUTUBE_TEMPLATE, {
    creator: latestVideo.channelTitle || source.channelTitle || source.channelId,
    title: latestVideo.title,
    url: latestVideo.url,
    game: "",
    platform: "YouTube"
  });

  return {
    content
  };
}

function buildTwitchMessage(source, stream) {
  const content = renderTemplate(source.announceTemplate, DEFAULT_TWITCH_TEMPLATE, {
    creator: source.displayName || stream.userName || source.login,
    title: stream.title,
    url: stream.url,
    game: stream.gameName,
    platform: "Twitch"
  });

  return {
    content
  };
}

export async function runContentCreatorPollCycle(client, options = {}) {
  const { guildId = "", reason = "interval" } = options;
  const { moduleConfigStore, env, logger } = client.botContext;

  const guilds = guildId
    ? [client.guilds.cache.get(guildId)].filter(Boolean)
    : Array.from(client.guilds.cache.values());

  let checkedGuilds = 0;
  let notificationsSent = 0;
  let errors = 0;

  for (const guild of guilds) {
    if (!moduleConfigStore.isModuleEnabled(guild.id, "content-creator")) {
      continue;
    }

    checkedGuilds += 1;
    const moduleState = moduleConfigStore.getModuleState(guild.id, "content-creator");
    const config = normalizeContentCreatorConfig(moduleState?.config);

    if (!config.notifyChannelId) {
      continue;
    }

    const notifyChannel = await resolveNotifyChannel(guild, config.notifyChannelId);
    if (!notifyChannel) {
      continue;
    }

    let changed = false;

    if (isYouTubeConfigured(env)) {
      for (const source of config.youtubeChannels) {
        try {
          const latestVideo = await fetchLatestYouTubeVideo(env, source.channelId);
          if (!latestVideo) {
            continue;
          }

          source.channelTitle = source.channelTitle || latestVideo.channelTitle;

          if (!source.lastVideoId) {
            source.lastVideoId = latestVideo.videoId;
            source.lastPublishedAt = latestVideo.publishedAt || "";
            changed = true;
            continue;
          }

          if (source.lastVideoId !== latestVideo.videoId) {
            await notifyChannel.send(buildYouTubeMessage(source, latestVideo));
            notificationsSent += 1;
            source.lastVideoId = latestVideo.videoId;
            source.lastPublishedAt = latestVideo.publishedAt || "";
            changed = true;
          }
        } catch (error) {
          errors += 1;
          logger.warn("ContentCreator: YouTube Poll fehlgeschlagen", {
            guildId: guild.id,
            channelId: source.channelId,
            reason,
            error: String(error)
          });
        }
      }
    }

    if (isTwitchConfigured(env)) {
      for (const source of config.twitchChannels) {
        try {
          const stream = await fetchTwitchStream(env, source.userId);

          if (!stream) {
            if (source.wasLive) {
              source.wasLive = false;
              changed = true;
            }
            continue;
          }

          source.displayName = source.displayName || stream.userName || source.login;

          const isNewLive = !source.wasLive || source.lastStreamId !== stream.streamId;
          if (isNewLive) {
            await notifyChannel.send(buildTwitchMessage(source, stream));
            notificationsSent += 1;
          }

          source.wasLive = true;
          source.lastStreamId = stream.streamId;
          changed = true;
        } catch (error) {
          errors += 1;
          logger.warn("ContentCreator: Twitch Poll fehlgeschlagen", {
            guildId: guild.id,
            login: source.login,
            reason,
            error: String(error)
          });
        }
      }
    }

    if (changed) {
      moduleConfigStore.setModuleConfig(guild.id, "content-creator", config);
    }
  }

  return {
    checkedGuilds,
    notificationsSent,
    errors
  };
}
