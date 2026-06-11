import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder
} from "discord.js";
import { normalizeContentCreatorConfig } from "./config.js";
import {
  fetchLatestYouTubeVideo,
  fetchTwitchStream,
  getYouTubeQuotaRetryAt,
  isYouTubeQuotaCoolingDown,
  isYouTubeQuotaExceededError,
  markYouTubeQuotaExceeded,
  isTwitchConfigured,
  isYouTubeConfigured
} from "./providers.js";

const DEFAULT_YOUTUBE_TEMPLATE = [
  "{creator} hat ein neues YouTube-Video veroeffentlicht!",
  "",
  "Hey Imperiale!",
  "Unser Community-Creator {creator} hat soeben ein neues Video hochgeladen!",
  "",
  "Schaut gerne vorbei, unterstuetzt ihn mit einem Like und begleitet ihn bei spannenden Momenten rund um Thrawns Revenge, Events, Entwicklungen und vielem mehr.",
  "",
  "Viel Spass beim Zuschauen!"
].join("\n");
const DEFAULT_TWITCH_TEMPLATE = [
  "{creator} ist LIVE auf Twitch!",
  "",
  "Hey Imperiale!",
  "Unser Community-Streamer {creator} ist soeben auf Twitch live gegangen!",
  "",
  "Schaut gerne vorbei, unterstuetzt ihn im Chat und begleitet ihn bei spannenden Momenten rund um Thrawns Revenge, Events, Entwicklungen und vielem mehr.",
  "",
  "Viel Spass im Stream!"
].join("\n");
const TWITCH_PURPLE = 0x9146FF;
const TWITCH_ICON_URL = "https://static.twitchcdn.net/assets/favicon-32-e29e246c157142c94346.png";
const YOUTUBE_RED = 0xFF0000;
const YOUTUBE_ICON_URL = "https://www.youtube.com/s/desktop/4e9f9f85/img/favicon_32x32.png";

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

function buildRoleMention(roleId) {
  const id = String(roleId || "").trim();
  return id ? `<@&${id}>` : "";
}

function mergeContentWithRoleMention(content, roleId) {
  const roleMention = buildRoleMention(roleId);
  if (!roleMention) {
    return content;
  }

  return `${roleMention}\n${content}`;
}

function buildYouTubeMessage(source, latestVideo, roleId = "") {
  const creatorName = latestVideo.channelTitle || source.channelTitle || source.channelId;
  const content = mergeContentWithRoleMention(renderTemplate(source.announceTemplate, DEFAULT_YOUTUBE_TEMPLATE, {
    creator: creatorName,
    title: latestVideo.title,
    url: latestVideo.url,
    game: "",
    platform: "YouTube"
  }), roleId);

  const footerTime = formatGermanClock(latestVideo.publishedAt || Date.now());
  const embed = new EmbedBuilder()
    .setColor(YOUTUBE_RED)
    .setAuthor({
      name: `${creatorName} hat ein neues Video auf YouTube!`,
      iconURL: YOUTUBE_ICON_URL
    })
    .setTitle(latestVideo.title || `${creatorName} hat ein neues Video hochgeladen`)
    .setURL(latestVideo.url)
    .addFields(
      {
        name: "Platform",
        value: "YouTube",
        inline: true
      },
      {
        name: "Kanal",
        value: creatorName,
        inline: true
      }
    )
    .setFooter({
      text: `Heute um ${footerTime} Uhr`
    });

  if (latestVideo.thumbnailUrl) {
    embed.setImage(latestVideo.thumbnailUrl);
  }

  const buttonRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setURL(latestVideo.url)
        .setLabel("Watch Video")
    );

  return {
    content,
    embeds: [embed],
    components: [buttonRow],
    allowedMentions: {
      roles: roleId ? [roleId] : []
    }
  };
}

function formatGermanClock(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());

  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function formatViewers(value) {
  const viewers = Number(value);
  if (!Number.isFinite(viewers) || viewers < 0) {
    return "0";
  }

  return new Intl.NumberFormat("de-DE").format(viewers);
}

function buildTwitchMessage(source, stream, roleId = "") {
  const creatorName = source.displayName || stream.userName || source.login;
  const content = mergeContentWithRoleMention(renderTemplate(source.announceTemplate, DEFAULT_TWITCH_TEMPLATE, {
    creator: creatorName,
    title: stream.title,
    url: stream.url,
    game: stream.gameName,
    platform: "Twitch"
  }), roleId);

  const footerTime = formatGermanClock(Date.now());
  const embed = new EmbedBuilder()
    .setColor(TWITCH_PURPLE)
    .setAuthor({
      name: `${creatorName} is now live on Twitch!`,
      iconURL: TWITCH_ICON_URL
    })
    .setTitle(stream.title || `${creatorName} ist jetzt live`)
    .setURL(stream.url)
    .addFields(
      {
        name: "Game",
        value: stream.gameName || "-",
        inline: true
      },
      {
        name: "Viewers",
        value: formatViewers(stream.viewerCount),
        inline: true
      }
    )
    .setFooter({
      text: `Heute um ${footerTime} Uhr`
    });

  if (stream.previewImageUrl) {
    embed.setImage(stream.previewImageUrl);
  }

  const buttonRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setURL(stream.url)
        .setLabel("Watch Stream")
    );

  return {
    content,
    embeds: [embed],
    components: [buttonRow],
    allowedMentions: {
      roles: roleId ? [roleId] : []
    }
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

    const youtubeRoleId = config.youtubeRoleId && guild.roles.cache.get(config.youtubeRoleId)
      ? config.youtubeRoleId
      : "";
    const twitchRoleId = config.twitchRoleId && guild.roles.cache.get(config.twitchRoleId)
      ? config.twitchRoleId
      : "";

    let changed = false;

    if (isYouTubeConfigured(env)) {
      if (!isYouTubeQuotaCoolingDown()) {
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
              await notifyChannel.send(buildYouTubeMessage(source, latestVideo, youtubeRoleId));
              notificationsSent += 1;
              source.lastVideoId = latestVideo.videoId;
              source.lastPublishedAt = latestVideo.publishedAt || "";
              changed = true;
            }
          } catch (error) {
            if (isYouTubeQuotaExceededError(error)) {
              markYouTubeQuotaExceeded();
              const retryAt = getYouTubeQuotaRetryAt();

              logger.warn("ContentCreator: YouTube Quota erreicht, Polling pausiert", {
                guildId: guild.id,
                channelId: source.channelId,
                reason,
                retryAt: retryAt ? new Date(retryAt).toISOString() : ""
              });
              break;
            }

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
            await notifyChannel.send(buildTwitchMessage(source, stream, twitchRoleId));
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
