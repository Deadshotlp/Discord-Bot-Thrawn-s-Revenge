import { PermissionFlagsBits } from "discord.js";

const LOG_FIELD_BY_TYPE = {
  general: "log_channel_id",
  member: "log_member_channel_id",
  message: "log_message_channel_id",
  voice: "log_voice_channel_id"
};

function resolveLogChannelId(settings, type) {
  const mappedField = LOG_FIELD_BY_TYPE[type] || LOG_FIELD_BY_TYPE.general;
  return settings?.[mappedField] || settings?.log_channel_id || null;
}

async function resolveTextChannel(guild, channelId) {
  if (!channelId) {
    return null;
  }

  const channel = guild.channels.cache.get(channelId)
    || (await guild.channels.fetch(channelId).catch(() => null));

  if (!channel || !channel.isTextBased()) {
    return null;
  }

  const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
  if (!me) {
    return null;
  }

  const channelPermissions = channel.permissionsFor(me);
  if (!channelPermissions) {
    return null;
  }

  const canWrite = channelPermissions.has(PermissionFlagsBits.ViewChannel)
    && channelPermissions.has(PermissionFlagsBits.SendMessages);

  if (!canWrite) {
    return null;
  }

  return channel;
}

export async function sendLog(guild, content, type = "general") {
  const { guildSettingsRepository, logger } = guild.client.botContext;
  const settings = guildSettingsRepository.getByGuildId(guild.id);
  const targetChannelId = resolveLogChannelId(settings, type);

  if (!targetChannelId) {
    return;
  }

  const channel = await resolveTextChannel(guild, targetChannelId);
  if (!channel) {
    return;
  }

  try {
    await channel.send({ content });
  } catch (error) {
    logger.warn("Log-Nachricht konnte nicht gesendet werden.", {
      guildId: guild.id,
      channelId: targetChannelId,
      error: String(error)
    });
  }
}

export async function sendBotPing(guild, content, options = {}) {
  const { guildSettingsRepository, logger } = guild.client.botContext;
  const settings = guildSettingsRepository.getByGuildId(guild.id);
  const pingChannelId = settings?.bot_ping_channel_id;

  if (!pingChannelId) {
    return;
  }

  const channel = await resolveTextChannel(guild, pingChannelId);
  if (!channel) {
    return;
  }

  try {
    await channel.send({
      content,
      ...options
    });
  } catch (error) {
    logger.warn("Bot-Ping konnte nicht gesendet werden.", {
      guildId: guild.id,
      channelId: pingChannelId,
      error: String(error)
    });
  }
}
