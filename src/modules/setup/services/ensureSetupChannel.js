import { ChannelType, PermissionFlagsBits } from "discord.js";

export async function ensureSetupChannel(guild, setupChannelName, logger) {
  const existing = guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildText && channel.name === setupChannelName
  );

  if (existing) {
    return { channel: existing, created: false };
  }

  const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
  const canManageChannels = me?.permissions?.has(PermissionFlagsBits.ManageChannels);

  if (!canManageChannels) {
    logger.warn("Setup-Channel konnte nicht erstellt werden: fehlende Rechte", {
      guildId: guild.id,
      channelName: setupChannelName
    });
    return { channel: null, created: false };
  }

  const created = await guild.channels.create({
    name: setupChannelName,
    type: ChannelType.GuildText,
    topic: "Setup und Modul-Verwaltung für den Bot",
    reason: "Automatischer Setup-Channel für modulare Basis"
  });

  return { channel: created, created: true };
}
