import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  OverwriteType,
  PermissionFlagsBits
} from "discord.js";

const WELCOME_CHANNEL_NAME = "willkommen";
const RULES_CHANNEL_NAME = "regeln";

const DEFAULT_RULES_TEXT = [
  "1) Behandle alle Mitglieder respektvoll und sachlich.",
  "2) Keine Beleidigungen, Diskriminierung oder toxisches Verhalten.",
  "3) Kein Spam, keine Werbung und keine unerwünschten Inhalte.",
  "4) Nutze Tickets und Supportkanäle nur für echte Anliegen.",
  "5) Folge den Anweisungen des Teams und beachte Kanalregeln."
].join("\n");

function createWelcomeEmbed(guildName) {
  return new EmbedBuilder()
    .setColor(0x1f6feb)
    .setTitle(`Willkommen auf ${guildName}`)
    .setDescription(
      [
        "Willkommen in unserer Community.",
        "Bitte lies zuerst das Regelwerk im Kanal #regeln.",
        "Danach kannst du dich dort über den Verifizierungsbutton freischalten."
      ].join("\n")
    );
}

function createRulesEmbed(guildName, rulesText) {
  return new EmbedBuilder()
    .setColor(0xb45f06)
    .setTitle(`Regelwerk und Verifizierung - ${guildName}`)
    .setDescription(rulesText || DEFAULT_RULES_TEXT)
    .setFooter({ text: "Mit Klick auf den Button bestätigst du das Regelwerk." });
}

function createRulesActionRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("verify_accept_rules")
        .setLabel("Regeln akzeptieren und verifizieren")
        .setStyle(ButtonStyle.Success)
    )
  ];
}

function buildPublicTextChannelOverwrites(guild) {
  const botId = guild.client.user?.id;
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      type: OverwriteType.Role,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: [PermissionFlagsBits.SendMessages]
    }
  ];

  if (botId) {
    overwrites.push({
      id: botId,
      type: OverwriteType.Member,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ManageMessages
      ]
    });
  }

  return overwrites;
}

function buildVerifiedCategoryOverwrites(guild, verifiedRoleId) {
  const botId = guild.client.user?.id;
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      type: OverwriteType.Role,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    {
      id: verifiedRoleId,
      type: OverwriteType.Role,
      allow: [PermissionFlagsBits.ViewChannel]
    }
  ];

  if (botId) {
    overwrites.push({
      id: botId,
      type: OverwriteType.Member,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages
      ]
    });
  }

  return overwrites;
}

async function resolveChannelByTypes(guild, channelId, allowedTypes = [ChannelType.GuildText]) {
  if (!channelId) {
    return null;
  }

  const channel = guild.channels.cache.get(channelId)
    || (await guild.channels.fetch(channelId).catch(() => null));

  if (!channel || !allowedTypes.includes(channel.type)) {
    return null;
  }

  return channel;
}

async function canManageChannels(guild) {
  const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
  if (!me) {
    return false;
  }

  return me.permissions.has(PermissionFlagsBits.ManageChannels);
}

async function ensurePublicTextChannel(
  guild,
  preferredChannelId,
  name,
  topic,
  logger,
  allowedTypes = [ChannelType.GuildText],
  strictPreferredChannel = false
) {
  let channel = await resolveChannelByTypes(guild, preferredChannelId, allowedTypes);

  if (preferredChannelId && !channel && strictPreferredChannel) {
    logger.warn("Konfigurierter Onboarding-Kanal konnte nicht aufgelöst werden.", {
      guildId: guild.id,
      configuredChannelId: preferredChannelId,
      channelName: name
    });
    return null;
  }

  if (!channel) {
    channel = guild.channels.cache.find(
      (candidate) => allowedTypes.includes(candidate.type) && candidate.name === name
    ) || null;
  }

  const permissionOverwrites = buildPublicTextChannelOverwrites(guild);

  if (channel) {
    if (!channel.manageable) {
      logger.warn("Onboarding-Kanal ist nicht verwaltbar, bestehender Kanal wird unverändert genutzt.", {
        guildId: guild.id,
        channelId: channel.id,
        channelName: channel.name
      });
      return channel;
    }

    await channel.setTopic(topic).catch(() => null);
    await channel.permissionOverwrites.set(permissionOverwrites, "Onboarding-Kanal öffentlich setzen");
    return channel;
  }

  try {
    return await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      topic,
      permissionOverwrites,
      reason: "Automatisch erstellter Onboarding-Kanal"
    });
  } catch (error) {
    logger.warn("Onboarding-Kanal konnte nicht erstellt werden.", {
      guildId: guild.id,
      channelName: name,
      error: String(error)
    });
    return null;
  }
}

export async function ensureOnboardingChannels(guild, guildSettingsRepository, logger) {
  const settings = guildSettingsRepository.getByGuildId(guild.id) || {};

  const manageChannelsAvailable = await canManageChannels(guild);
  if (!manageChannelsAvailable && !settings.welcome_channel_id && !settings.rules_channel_id) {
    logger.warn("Onboarding übersprungen: Bot hat keine Rechte zum Verwalten von Kanälen.", {
      guildId: guild.id
    });
    return settings;
  }

  const welcomeChannel = await ensurePublicTextChannel(
    guild,
    settings.welcome_channel_id,
    WELCOME_CHANNEL_NAME,
    "Startpunkt für neue Mitglieder",
    logger,
    [ChannelType.GuildText, ChannelType.GuildAnnouncement],
    true
  );

  const rulesChannel = await ensurePublicTextChannel(
    guild,
    settings.rules_channel_id,
    RULES_CHANNEL_NAME,
    "Regelwerk und Verifizierung",
    logger
  );

  const updates = {};
  if (welcomeChannel?.id) {
    updates.welcome_channel_id = welcomeChannel.id;
  }

  if (rulesChannel?.id) {
    updates.rules_channel_id = rulesChannel.id;
  }

  const updated = Object.keys(updates).length > 0
    ? guildSettingsRepository.setFields(guild.id, updates)
    : settings;

  await ensureWelcomeMessage(guild, updated, logger);
  await ensureRulesMessage(guild, updated, guildSettingsRepository, logger);

  return guildSettingsRepository.getByGuildId(guild.id) || updated;
}

export async function ensureWelcomeMessage(guild, settings, logger) {
  const welcomeChannel = await resolveChannelByTypes(guild, settings?.welcome_channel_id, [
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement
  ]);
  if (!welcomeChannel) {
    return;
  }

  const recentMessages = await welcomeChannel.messages.fetch({ limit: 10 }).catch(() => null);
  const existingMessage = recentMessages?.find(
    (message) => message.author.id === guild.client.user.id && message.embeds?.[0]?.title?.startsWith("Willkommen")
  );

  const payload = {
    embeds: [createWelcomeEmbed(guild.name)]
  };

  if (existingMessage) {
    await existingMessage.edit(payload).catch(() => null);
    return;
  }

  await welcomeChannel.send(payload).catch((error) => {
    logger.warn("Willkommensnachricht konnte nicht gepostet werden.", {
      guildId: guild.id,
      channelId: welcomeChannel.id,
      error: String(error)
    });
  });
}

export async function ensureRulesMessage(guild, settings, guildSettingsRepository, logger) {
  const rulesChannel = await resolveChannelByTypes(guild, settings?.rules_channel_id, [ChannelType.GuildText]);
  if (!rulesChannel) {
    return;
  }

  if (!rulesChannel.isTextBased()) {
    return;
  }

  const payload = {
    embeds: [createRulesEmbed(guild.name, settings?.rules_text || DEFAULT_RULES_TEXT)],
    components: createRulesActionRows()
  };

  let message = null;
  if (settings?.rules_message_id) {
    message = await rulesChannel.messages.fetch(settings.rules_message_id).catch(() => null);
  }

  if (message) {
    await message.edit(payload).catch((error) => {
      logger.warn("Regelwerk-Nachricht konnte nicht aktualisiert werden.", {
        guildId: guild.id,
        channelId: rulesChannel.id,
        error: String(error)
      });
    });
    return;
  }

  const sent = await rulesChannel.send(payload).catch((error) => {
    logger.warn("Regelwerk-Nachricht konnte nicht gepostet werden.", {
      guildId: guild.id,
      channelId: rulesChannel.id,
      error: String(error)
    });
    return null;
  });

  if (!sent) {
    return;
  }

  guildSettingsRepository.setField(guild.id, "rules_message_id", sent.id);

  logger.info("Regelwerk-Panel gepostet oder aktualisiert.", {
    guildId: guild.id,
    rulesChannelId: rulesChannel.id,
    messageId: sent.id
  });
}

export async function applyVerifiedVisibilityToCategories(guild, settings, logger) {
  const verifiedRoleId = settings?.verified_role_id;

  if (!verifiedRoleId) {
    return { updated: 0, skipped: true };
  }

  const excludedChannelIds = new Set([
    settings?.welcome_channel_id,
    settings?.rules_channel_id
  ].filter(Boolean));

  let updatedCount = 0;
  let skippedCount = 0;

  for (const channel of guild.channels.cache.values()) {
    if (channel.type !== ChannelType.GuildCategory) {
      continue;
    }

    if (!channel.viewable || !channel.manageable) {
      skippedCount += 1;
      continue;
    }

    const hasExcludedChild = guild.channels.cache.some(
      (child) => child.parentId === channel.id && excludedChannelIds.has(child.id)
    );

    if (hasExcludedChild) {
      continue;
    }

    try {
      await channel.permissionOverwrites.set(
        buildVerifiedCategoryOverwrites(guild, verifiedRoleId),
        "Kategorie auf verifizierte Nutzer beschränken"
      );
      updatedCount += 1;
    } catch (error) {
      logger.warn("Kategorie konnte nicht auf Verifiziert-Sichtbarkeit gestellt werden.", {
        guildId: guild.id,
        categoryId: channel.id,
        error: String(error)
      });
    }
  }

  return { updated: updatedCount, skipped: skippedCount };
}

export async function handleVerificationButton(interaction, guildSettingsRepository) {
  const settings = guildSettingsRepository.getByGuildId(interaction.guildId);
  const verifiedRoleId = settings?.verified_role_id;

  if (!verifiedRoleId) {
    await interaction.reply({
      content: "Verifiziert-Rolle ist noch nicht konfiguriert. Bitte wende dich an das Team.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const role = interaction.guild.roles.cache.get(verifiedRoleId)
    || (await interaction.guild.roles.fetch(verifiedRoleId).catch(() => null));

  if (!role) {
    await interaction.reply({
      content: "Die konfigurierte Verifiziert-Rolle wurde nicht gefunden.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (interaction.member.roles.cache.has(verifiedRoleId)) {
    await interaction.reply({
      content: "Du bist bereits verifiziert.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  try {
    await interaction.member.roles.add(role, "Regelwerk akzeptiert");
  } catch {
    await interaction.reply({
      content: "Verifizierung fehlgeschlagen. Bitte prüfe die Rollen-Hierarchie und Bot-Rechte.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.reply({
    content: "Verifizierung erfolgreich. Willkommen auf dem Server.",
    flags: MessageFlags.Ephemeral
  });
}

export function getDefaultRulesText() {
  return DEFAULT_RULES_TEXT;
}
