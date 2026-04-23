import { ChannelType, PermissionFlagsBits } from "discord.js";

const PROVISION_CHANNELS = [
  {
    settingField: "log_channel_id",
    name: "bot-logs-allgemein",
    topic: "Allgemeine Bot-Logs"
  },
  {
    settingField: "log_member_channel_id",
    name: "bot-logs-member",
    topic: "Member Join/Leave Logs"
  },
  {
    settingField: "log_message_channel_id",
    name: "bot-logs-nachrichten",
    topic: "Nachrichten-Logs"
  },
  {
    settingField: "log_voice_channel_id",
    name: "bot-logs-voice",
    topic: "Voice Join/Leave/Switch Logs"
  },
  {
    settingField: "bot_ping_channel_id",
    name: "bot-pings-support",
    topic: "Support-Benachrichtigungen und Ticket-Pings"
  }
];

async function ensureTextChannelInCategory(guild, categoryId, name, topic) {
  const botId = guild.client.user?.id;

  const existing = guild.channels.cache.find(
    (channel) =>
      channel.type === ChannelType.GuildText &&
      channel.parentId === categoryId &&
      channel.name === name
  );

  if (existing) {
    if (botId && existing.manageable) {
      await existing.permissionOverwrites.edit(botId, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        EmbedLinks: true
      }, { reason: "Bot-Zugriff auf Systemkanal sicherstellen" });
    }

    return existing;
  }

  const permissionOverwrites = [];
  if (botId) {
    permissionOverwrites.push({
      id: botId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks
      ]
    });
  }

  return guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: categoryId,
    topic,
    permissionOverwrites,
    reason: "Automatisch erzeugter Bot-Systemkanal"
  });
}

export async function provisionAdminCategoryChannels(guild, categoryId, guildSettingsRepository) {
  const category = guild.channels.cache.get(categoryId)
    || (await guild.channels.fetch(categoryId).catch(() => null));

  if (!category || category.type !== ChannelType.GuildCategory) {
    throw new Error("Die ausgewaehlte Log-Kategorie wurde nicht gefunden.");
  }

  if (!category.viewable) {
    throw new Error("Bot hat keinen Zugriff auf die ausgewaehlte Log-Kategorie.");
  }

  const updates = {
    admin_category_id: categoryId
  };

  for (const channelDefinition of PROVISION_CHANNELS) {
    const createdChannel = await ensureTextChannelInCategory(
      guild,
      categoryId,
      channelDefinition.name,
      channelDefinition.topic
    );

    updates[channelDefinition.settingField] = createdChannel.id;
  }

  return guildSettingsRepository.setFields(guild.id, updates);
}
