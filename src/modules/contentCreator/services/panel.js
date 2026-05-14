import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";

export const CONTENT_CREATOR_SETUP_MODAL_ID = "content_creator_setup_modal";
export const CONTENT_CREATOR_SETUP_CHANNEL_INPUT_ID = "content_creator_setup_channel";
export const CONTENT_CREATOR_SETUP_YOUTUBE_INPUT_ID = "content_creator_setup_youtube";
export const CONTENT_CREATOR_SETUP_TWITCH_INPUT_ID = "content_creator_setup_twitch";

function safeString(value) {
  return String(value || "").trim();
}

function serializeSourceLines(sources, keyField) {
  const list = Array.isArray(sources) ? sources : [];

  return list.map((source) => {
    const key = safeString(source?.[keyField]);
    const template = safeString(source?.announceTemplate);

    if (!key) {
      return "";
    }

    return template ? `${key} = ${template}` : key;
  }).filter(Boolean).join("\n");
}

function safeInputValue(value, maxLength) {
  const text = String(value || "");
  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(0, maxLength);
}

export function parseProfileLines(rawText) {
  const lines = String(rawText || "")
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line) => {
    const parts = line.split("=");
    if (parts.length <= 1) {
      return {
        profile: line,
        template: ""
      };
    }

    return {
      profile: parts.shift().trim(),
      template: parts.join("=").trim()
    };
  }).filter((entry) => entry.profile);
}

export function buildContentCreatorSetupModal(config = {}) {
  const notifyChannelId = safeString(config.notifyChannelId);
  const youtubeValue = serializeSourceLines(config.youtubeChannels, "channelId");
  const twitchValue = serializeSourceLines(config.twitchChannels, "login");

  const modal = new ModalBuilder()
    .setCustomId(CONTENT_CREATOR_SETUP_MODAL_ID)
    .setTitle("Content Creator Setup");

  const channelInput = new TextInputBuilder()
    .setCustomId(CONTENT_CREATOR_SETUP_CHANNEL_INPUT_ID)
    .setLabel("Ankuendigungs-Channel (ID oder #Erwaehnung)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder("Leer = Benachrichtigungen pausieren")
    .setMaxLength(120);

  if (notifyChannelId) {
    channelInput.setValue(safeInputValue(notifyChannelId, 120));
  }

  const youtubeInput = new TextInputBuilder()
    .setCustomId(CONTENT_CREATOR_SETUP_YOUTUBE_INPUT_ID)
    .setLabel("YouTube Profile (eine Zeile, optional = Text)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setPlaceholder("@creator = Neues Video: {title} {url}")
    .setMaxLength(1800);

  if (youtubeValue) {
    youtubeInput.setValue(safeInputValue(youtubeValue, 1800));
  }

  const twitchInput = new TextInputBuilder()
    .setCustomId(CONTENT_CREATOR_SETUP_TWITCH_INPUT_ID)
    .setLabel("Twitch Profile (eine Zeile, optional = Text)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setPlaceholder("streamer = {creator} ist LIVE: {title} {url}")
    .setMaxLength(1800);

  if (twitchValue) {
    twitchInput.setValue(safeInputValue(twitchValue, 1800));
  }

  modal.addComponents(
    new ActionRowBuilder().addComponents(channelInput),
    new ActionRowBuilder().addComponents(youtubeInput),
    new ActionRowBuilder().addComponents(twitchInput)
  );

  return modal;
}
