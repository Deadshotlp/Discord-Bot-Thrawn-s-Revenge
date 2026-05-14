import { ChannelType, MessageFlags } from "discord.js";
import { canManageServer } from "../../core/permissions.js";
import { normalizeContentCreatorConfig } from "./services/config.js";
import { runContentCreatorPollCycle } from "./services/polling.js";
import {
  fetchLatestYouTubeVideo,
  fetchTwitchStream,
  fetchTwitchUser,
  fetchYouTubeChannel,
  isTwitchConfigured,
  isYouTubeConfigured
} from "./services/providers.js";
import {
  CONTENT_CREATOR_SETUP_CHANNEL_INPUT_ID,
  CONTENT_CREATOR_SETUP_MODAL_ID,
  CONTENT_CREATOR_SETUP_TWITCH_INPUT_ID,
  CONTENT_CREATOR_SETUP_YOUTUBE_INPUT_ID,
  parseProfileLines
} from "./services/panel.js";

const runtime = {
  timer: null,
  running: false
};

function getPollIntervalMs(env) {
  const seconds = Number.parseInt(String(env.creatorPollIntervalSeconds || 180), 10);
  const safeSeconds = Number.isInteger(seconds) ? Math.max(30, seconds) : 180;
  return safeSeconds * 1000;
}

async function runCycleSafe(client, reason) {
  if (runtime.running) {
    return;
  }

  runtime.running = true;
  try {
    await runContentCreatorPollCycle(client, { reason });
  } finally {
    runtime.running = false;
  }
}

async function handleContentCreatorReady({ client }) {
  if (runtime.timer) {
    return;
  }

  const intervalMs = getPollIntervalMs(client.botContext.env);
  await runCycleSafe(client, "ready");

  runtime.timer = setInterval(() => {
    runCycleSafe(client, "interval").catch((error) => {
      client.botContext.logger.warn("ContentCreator Polling fehlgeschlagen", {
        error: String(error)
      });
    });
  }, intervalMs);
}

function toSnowflake(value) {
  const text = String(value || "").trim();
  const matches = text.match(/\d{16,20}/g) || [];
  return matches.at(-1) || "";
}

function isTextAnnouncementChannel(channel) {
  return Boolean(channel && [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type));
}

async function handleContentCreatorInteraction({ client, interaction }) {
  if (!interaction.isModalSubmit() || interaction.customId !== CONTENT_CREATOR_SETUP_MODAL_ID) {
    return;
  }

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "Dieses Setup funktioniert nur auf einem Server.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!canManageServer(interaction.member)) {
    await interaction.reply({
      content: "Nur Admins oder Mitglieder mit Server-verwalten duerfen dies konfigurieren.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral
  });

  const { moduleConfigStore, env } = client.botContext;
  const moduleState = moduleConfigStore.getModuleState(interaction.guildId, "content-creator");

  if (!moduleState) {
    await interaction.editReply({
      content: "Content-Creator Modul wurde nicht gefunden."
    });
    return;
  }

  const currentConfig = normalizeContentCreatorConfig(moduleState.config);
  const currentYoutube = new Map(currentConfig.youtubeChannels.map((entry) => [entry.channelId, entry]));
  const currentTwitch = new Map(currentConfig.twitchChannels.map((entry) => [entry.login, entry]));

  const channelInput = interaction.fields.getTextInputValue(CONTENT_CREATOR_SETUP_CHANNEL_INPUT_ID)?.trim() || "";
  let notifyChannelId = "";

  if (channelInput) {
    const channelId = toSnowflake(channelInput);
    const channel = interaction.guild.channels.cache.get(channelId)
      || (await interaction.guild.channels.fetch(channelId).catch(() => null));

    if (!isTextAnnouncementChannel(channel)) {
      await interaction.editReply({
        content: "Ankuendigungs-Channel ist ungueltig. Bitte ID oder #Erwaehnung eines Textkanals nutzen."
      });
      return;
    }

    notifyChannelId = channel.id;
  }

  const youtubeEntries = parseProfileLines(interaction.fields.getTextInputValue(CONTENT_CREATOR_SETUP_YOUTUBE_INPUT_ID));
  const twitchEntries = parseProfileLines(interaction.fields.getTextInputValue(CONTENT_CREATOR_SETUP_TWITCH_INPUT_ID));

  const errors = [];
  const nextYoutube = new Map();
  const nextTwitch = new Map();

  if (youtubeEntries.length > 0 && !isYouTubeConfigured(env)) {
    errors.push("YOUTUBE_API_KEY fehlt. YouTube-Profile wurden nicht uebernommen.");
  } else {
    for (const entry of youtubeEntries) {
      const channelInfo = await fetchYouTubeChannel(env, entry.profile).catch(() => null);
      if (!channelInfo) {
        errors.push(`YouTube Profil nicht gefunden: ${entry.profile}`);
        continue;
      }

      const previous = currentYoutube.get(channelInfo.channelId);
      const latest = await fetchLatestYouTubeVideo(env, channelInfo.channelId).catch(() => null);

      nextYoutube.set(channelInfo.channelId, {
        channelId: channelInfo.channelId,
        channelTitle: channelInfo.title,
        lastVideoId: previous?.lastVideoId || latest?.videoId || "",
        lastPublishedAt: previous?.lastPublishedAt || latest?.publishedAt || "",
        announceTemplate: entry.template
      });
    }
  }

  if (twitchEntries.length > 0 && !isTwitchConfigured(env)) {
    errors.push("TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET fehlt. Twitch-Profile wurden nicht uebernommen.");
  } else {
    for (const entry of twitchEntries) {
      const user = await fetchTwitchUser(env, entry.profile).catch(() => null);
      if (!user) {
        errors.push(`Twitch Profil nicht gefunden: ${entry.profile}`);
        continue;
      }

      const previous = currentTwitch.get(user.login);
      const stream = await fetchTwitchStream(env, user.id).catch(() => null);

      nextTwitch.set(user.login, {
        login: user.login,
        userId: user.id,
        displayName: user.displayName,
        lastStreamId: previous?.lastStreamId || stream?.streamId || "",
        wasLive: previous ? Boolean(previous.wasLive) : Boolean(stream),
        announceTemplate: entry.template
      });
    }
  }

  const nextConfig = {
    notifyChannelId,
    youtubeChannels: Array.from(nextYoutube.values()),
    twitchChannels: Array.from(nextTwitch.values())
  };

  moduleConfigStore.setModuleConfig(interaction.guildId, "content-creator", nextConfig);

  await interaction.editReply({
    content: [
      notifyChannelId
        ? `Ankuendigungs-Channel gesetzt: <#${notifyChannelId}>`
        : "Ankuendigungs-Channel geleert (Benachrichtigungen pausiert).",
      `YouTube Profile gespeichert: ${nextConfig.youtubeChannels.length}`,
      `Twitch Profile gespeichert: ${nextConfig.twitchChannels.length}`,
      errors.length > 0 ? `Hinweise:\n${errors.slice(0, 8).join("\n")}` : ""
    ].filter(Boolean).join("\n")
  });
}

handleContentCreatorInteraction.alwaysAvailable = true;

export const contentCreatorModule = {
  name: "content-creator",
  defaultEnabled: false,
  defaultConfig: {
    notifyChannelId: "",
    youtubeChannels: [],
    twitchChannels: []
  },
  commands: [],
  events: {
    ready: [handleContentCreatorReady],
    interactionCreate: [handleContentCreatorInteraction]
  }
};
