import { ChannelType, MessageFlags, PermissionFlagsBits } from "discord.js";
import { canManageServer } from "../../core/permissions.js";
import {
  reactionRoleCommand,
  REACTION_ROLE_PANEL_MAPPINGS_INPUT_ID,
  REACTION_ROLE_PANEL_MODAL_PREFIX,
  REACTION_ROLE_PANEL_TEXT_INPUT_ID,
  REACTION_ROLE_PANEL_TITLE_INPUT_ID
} from "./commands/reactionRole.js";
import {
  buildBindingFromReaction,
  findReactionRoleBindingIndex,
  findReactionRoleBindingsByReaction,
  normalizeReactionRoleBindings,
  parseReactionRoleMappingLines
} from "./services/config.js";

const missingManageMessagesWarnedChannels = new Set();

async function resolveGuildMember(guild, userId) {
  return guild.members.cache.get(userId)
    || (await guild.members.fetch(userId).catch(() => null));
}

async function resolveGuildRole(guild, roleId) {
  return guild.roles.cache.get(roleId)
    || (await guild.roles.fetch(roleId).catch(() => null));
}

async function canBotManageMessages(guild, channel) {
  const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
  if (!me || !channel?.permissionsFor) {
    return false;
  }

  const permissions = channel.permissionsFor(me);
  return Boolean(permissions?.has(PermissionFlagsBits.ManageMessages));
}

function toSnowflake(value) {
  const text = String(value || "").trim();
  const matches = text.match(/\d{16,20}/g) || [];
  return matches.at(-1) || "";
}

function isSupportedReactionChannel(channel) {
  if (!channel) {
    return false;
  }

  return [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type);
}

async function handleReactionRoleInteraction({ client, interaction }) {
  if (!interaction.isModalSubmit() || !interaction.customId.startsWith(REACTION_ROLE_PANEL_MODAL_PREFIX)) {
    return;
  }

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "Dieser Dialog funktioniert nur auf einem Server.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!canManageServer(interaction.member)) {
    await interaction.reply({
      content: "Nur Admins oder Mitglieder mit Server-verwalten dürfen Reaction-Roles verwalten.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral
  });

  const channelId = toSnowflake(interaction.customId.slice(REACTION_ROLE_PANEL_MODAL_PREFIX.length));
  const channel = interaction.guild.channels.cache.get(channelId)
    || (await interaction.guild.channels.fetch(channelId).catch(() => null));

  if (!isSupportedReactionChannel(channel)) {
    await interaction.editReply({
      content: "Zielkanal wurde nicht gefunden oder ist kein Textkanal."
    });
    return;
  }

  const panelTitle = interaction.fields.getTextInputValue(REACTION_ROLE_PANEL_TITLE_INPUT_ID)?.trim() || "";
  const panelText = interaction.fields.getTextInputValue(REACTION_ROLE_PANEL_TEXT_INPUT_ID)?.trim() || "";
  const mappingsInput = interaction.fields.getTextInputValue(REACTION_ROLE_PANEL_MAPPINGS_INPUT_ID);
  const { entries, errors } = parseReactionRoleMappingLines(mappingsInput);

  if (!panelText) {
    await interaction.editReply({
      content: "Bitte gib einen Panel-Text an."
    });
    return;
  }

  if (errors.length > 0) {
    await interaction.editReply({
      content: [
        "Fehler in den Mappings:",
        ...errors.slice(0, 6),
        errors.length > 6 ? `... und ${errors.length - 6} weitere Fehler` : ""
      ].filter(Boolean).join("\n")
    });
    return;
  }

  const validEntries = [];
  const invalidRoleIds = [];

  for (const entry of entries) {
    const role = await resolveGuildRole(interaction.guild, entry.roleId);
    if (!role) {
      invalidRoleIds.push(entry.roleId);
      continue;
    }

    validEntries.push({ ...entry, roleId: role.id });
  }

  if (validEntries.length === 0) {
    await interaction.editReply({
      content: "Keine gültigen Rollen gefunden. Bitte nutze Rollen-Erwähnungen oder IDs."
    });
    return;
  }

  const summaryLines = validEntries.map((entry) => `${entry.emojiToken} -> <@&${entry.roleId}>`);
  const content = [
    panelTitle ? `**${panelTitle}**` : "",
    panelText,
    "",
    "Reagiere auf ein Emoji, um die verknüpfte Rolle zu erhalten:",
    ...summaryLines
  ].filter(Boolean).join("\n");

  const panelMessage = await channel.send({ content }).catch(() => null);
  if (!panelMessage) {
    await interaction.editReply({
      content: "Panel-Nachricht konnte nicht gesendet werden. Prüfe Bot-Rechte im Kanal."
    });
    return;
  }

  const moduleState = client.botContext.moduleConfigStore.getModuleState(interaction.guildId, "reaction-role");
  const existingBindings = normalizeReactionRoleBindings(moduleState?.config?.bindings);
  const nextBindings = [...existingBindings];
  const failedReactions = [];
  let savedMappings = 0;

  for (const entry of validEntries) {
    const reaction = await panelMessage.react(entry.emojiToken).catch(() => null);
    if (!reaction) {
      failedReactions.push(entry.emojiToken);
      continue;
    }

    const binding = buildBindingFromReaction({
      channelId: channel.id,
      messageId: panelMessage.id,
      roleId: entry.roleId,
      reaction
    });

    if (!binding) {
      failedReactions.push(entry.emojiToken);
      continue;
    }

    const existingIndex = findReactionRoleBindingIndex(nextBindings, {
      messageId: binding.messageId,
      emojiId: binding.emojiId,
      emojiName: binding.emojiName
    });

    if (existingIndex >= 0) {
      nextBindings[existingIndex] = binding;
    } else {
      nextBindings.push(binding);
    }

    savedMappings += 1;
  }

  if (savedMappings > 0) {
    client.botContext.moduleConfigStore.setModuleConfig(interaction.guildId, "reaction-role", {
      bindings: nextBindings
    });
  }

  await interaction.editReply({
    content: [
      `Panel erstellt: <#${channel.id}> / ${panelMessage.id}`,
      `Gespeicherte Mappings: ${savedMappings}`,
      invalidRoleIds.length > 0 ? `Ungültige Rollen: ${invalidRoleIds.map((roleId) => `<@&${roleId}>`).join(" ")}` : "",
      failedReactions.length > 0 ? `Nicht reagierbare Emojis: ${failedReactions.join(", ")}` : ""
    ].filter(Boolean).join("\n")
  });
}

async function handleReactionRoleAdd({ client, reaction, user }) {
  if (!reaction || !user || user.bot) {
    return;
  }

  if (reaction.partial) {
    await reaction.fetch().catch(() => null);
  }

  if (reaction.message.partial) {
    await reaction.message.fetch().catch(() => null);
  }

  const guild = reaction.message.guild;
  if (!guild) {
    return;
  }

  const moduleState = client.botContext.moduleConfigStore.getModuleState(guild.id, "reaction-role");
  const bindings = normalizeReactionRoleBindings(moduleState?.config?.bindings);
  if (bindings.length === 0) {
    return;
  }

  const matchedBindings = findReactionRoleBindingsByReaction(
    bindings,
    reaction.message.id,
    reaction.emoji
  );

  if (matchedBindings.length === 0) {
    return;
  }

  const member = await resolveGuildMember(guild, user.id);
  let assignedRole = false;

  for (const binding of matchedBindings) {
    if (!member) {
      break;
    }

    const role = await resolveGuildRole(guild, binding.roleId);
    if (!role) {
      continue;
    }

    if (member.roles.cache.has(role.id)) {
      continue;
    }

    await member.roles.add(role, "Reaction-Role Auswahl").then(() => {
      assignedRole = true;
    }).catch((error) => {
      client.botContext.logger.warn("Reaction-Role konnte nicht vergeben werden", {
        guildId: guild.id,
        userId: user.id,
        roleId: role.id,
        messageId: reaction.message.id,
        error: String(error)
      });
    });
  }

  if (assignedRole) {
    const channel = reaction.message.channel;
    const canManageMessages = await canBotManageMessages(guild, channel);

    if (!canManageMessages) {
      const channelKey = `${guild.id}:${channel?.id || "unknown"}`;
      if (!missingManageMessagesWarnedChannels.has(channelKey)) {
        missingManageMessagesWarnedChannels.add(channelKey);
        client.botContext.logger.info("Reaction-Role: Reaction kann nicht entfernt werden (fehlende Rechte)", {
          guildId: guild.id,
          channelId: channel?.id || null,
          requiredPermission: "ManageMessages"
        });
      }

      return;
    }

    await reaction.users.remove(user.id).catch((error) => {
      client.botContext.logger.warn("Reaction konnte nicht entfernt werden", {
        guildId: guild.id,
        userId: user.id,
        messageId: reaction.message.id,
        error: String(error)
      });
    });
  }
}

export const reactionRoleModule = {
  name: "reaction-role",
  defaultEnabled: false,
  defaultConfig: {
    bindings: []
  },
  commands: [reactionRoleCommand],
  events: {
    interactionCreate: [handleReactionRoleInteraction],
    messageReactionAdd: [handleReactionRoleAdd]
  }
};
