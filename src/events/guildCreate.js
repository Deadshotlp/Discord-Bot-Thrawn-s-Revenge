import { ChannelType, OverwriteType, PermissionFlagsBits } from "discord.js";
import { postSetupPanels } from "../features/setup/panel.js";

function buildSetupPermissionOverwrites(guild) {
  const botId = guild.client.user?.id;

  const overwrites = [
    {
      id: guild.roles.everyone.id,
      type: OverwriteType.Role,
      deny: [PermissionFlagsBits.ViewChannel]
    }
  ];

  if (guild.ownerId) {
    overwrites.push({
      id: guild.ownerId,
      type: OverwriteType.Member,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory
      ]
    });
  }

  if (botId) {
    overwrites.push({
      id: botId,
      type: OverwriteType.Member,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.UseApplicationCommands
      ]
    });
  }

  const adminRoles = guild.roles.cache
    .filter(
      (role) =>
        role.id !== guild.roles.everyone.id &&
        role.permissions.has(PermissionFlagsBits.Administrator)
    )
    .map((role) => role.id);

  for (const roleId of adminRoles) {
    overwrites.push({
      id: roleId,
      type: OverwriteType.Role,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory
      ]
    });
  }

  return overwrites;
}

async function ensureSetupChannel(guild, setupChannelName) {
  const permissionOverwrites = buildSetupPermissionOverwrites(guild);

  const existing = guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildText && channel.name === setupChannelName
  );

  if (existing) {
    await existing.permissionOverwrites.set(
      permissionOverwrites,
      "Setup-Channel Rechte aktualisiert"
    );
    return existing;
  }

  return guild.channels.create({
    name: setupChannelName,
    type: ChannelType.GuildText,
    topic: "Bot-Konfiguration für Rollen, Kanäle und Feature-Setup",
    permissionOverwrites,
    reason: "Automatischer Setup-Channel für Bot-Konfiguration"
  });
}

async function fetchStoredSetupChannel(guild, channelId) {
  if (!channelId) {
    return null;
  }

  const channel = guild.channels.cache.get(channelId)
    || (await guild.channels.fetch(channelId).catch(() => null));

  if (!channel || channel.type !== ChannelType.GuildText) {
    return null;
  }

  return channel;
}

export async function bootstrapSetupForGuild(guild, options = {}) {
  const { forcePostPanels = false, source = "unknown" } = options;
  const { env, logger, guildSettingsRepository } = guild.client.botContext;

  guildSettingsRepository.ensureGuild(guild.id);

  const settingsBefore = guildSettingsRepository.getByGuildId(guild.id);
  let setupChannel = await fetchStoredSetupChannel(guild, settingsBefore?.setup_channel_id);
  const channelWasMissing = !setupChannel;

  if (!setupChannel) {
    if (!env.forceSetupOnGuildJoin) {
      logger.info("Auto-Setup ist deaktiviert.", { guildId: guild.id, source });
      return;
    }

    try {
      setupChannel = await ensureSetupChannel(guild, env.setupChannelName);
      guildSettingsRepository.setField(guild.id, "setup_channel_id", setupChannel.id);
      logger.info("Setup-Channel wurde erstellt oder wiederhergestellt.", {
        guildId: guild.id,
        setupChannelId: setupChannel.id,
        source
      });
    } catch (error) {
      logger.warn("Setup-Channel konnte nicht automatisch erstellt oder aktualisiert werden.", {
        guildId: guild.id,
        source,
        error: String(error)
      });
      return;
    }
  }

  const shouldPostPanels = forcePostPanels || channelWasMissing;

  if (!shouldPostPanels) {
    return;
  }

  try {
    await postSetupPanels(setupChannel);

    logger.info("Setup-Panel automatisch gepostet.", {
      guildId: guild.id,
      setupChannelId: setupChannel.id,
      source
    });
  } catch (error) {
    logger.warn("Setup-Panels konnten nicht automatisch gepostet werden.", {
      guildId: guild.id,
      setupChannelId: setupChannel?.id,
      source,
      error: String(error)
    });
  }
}

export async function handleGuildCreate(guild) {
  const { logger } = guild.client.botContext;

  logger.info("Bot ist einem neuen Server beigetreten.", { guildId: guild.id, guildName: guild.name });
  await bootstrapSetupForGuild(guild, { forcePostPanels: true, source: "guild-create" });
}
