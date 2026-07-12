import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags
} from "discord.js";
import { canManageServer } from "../../core/permissions.js";
import {
  reactionRoleCommand,
  REACTION_ROLE_PANEL_MAPPINGS_INPUT_ID,
  REACTION_ROLE_PANEL_MODAL_PREFIX,
  REACTION_ROLE_PANEL_TEXT_INPUT_ID,
  REACTION_ROLE_PANEL_TITLE_INPUT_ID
} from "./commands/reactionRole.js";
import {
  normalizeReactionRoleBindings,
  parseReactionRoleMappingLines
} from "./services/config.js";

const REACTION_ROLE_EMBED_COLOR = 0xed4245;
const REACTION_ROLE_EMBED_DESCRIPTION_MAX_LENGTH = 4000;
const REACTION_ROLE_BUTTON_PREFIX = "reaction_role_toggle:";
const REACTION_ROLE_MAX_BUTTONS = 25;

async function resolveGuildMember(guild, userId) {
  return guild.members.cache.get(userId)
    || (await guild.members.fetch(userId).catch(() => null));
}

async function resolveGuildRole(guild, roleId) {
  return guild.roles.cache.get(roleId)
    || (await guild.roles.fetch(roleId).catch(() => null));
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

function truncateText(value, maxLength) {
  const text = String(value || "");
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function toButtonCustomId(roleId) {
  return `${REACTION_ROLE_BUTTON_PREFIX}${roleId}`;
}

function getRoleIdFromButtonCustomId(customId) {
  if (!String(customId || "").startsWith(REACTION_ROLE_BUTTON_PREFIX)) {
    return "";
  }

  return toSnowflake(String(customId).slice(REACTION_ROLE_BUTTON_PREFIX.length));
}

function splitIntoChunks(list, chunkSize) {
  const source = Array.isArray(list) ? list : [];
  const chunks = [];

  for (let index = 0; index < source.length; index += chunkSize) {
    chunks.push(source.slice(index, index + chunkSize));
  }

  return chunks;
}

function mapEntryToButtonEmoji(entry) {
  const emojiData = entry?.emoji;
  if (!emojiData) {
    return null;
  }

  if (emojiData.emojiId) {
    return {
      id: emojiData.emojiId
    };
  }

  if (emojiData.emojiName) {
    return emojiData.emojiName;
  }

  return null;
}

function buildReactionRolePanelPayload(panelTitle, panelText, entries) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const roleLines = safeEntries.map((entry) => `${entry.emojiToken}  <@&${entry.roleId}>`);

  const description = truncateText(
    [
      panelText,
      "",
      "--",
      "",
      "**Verfuegbare Ping-Rollen**",
      ...roleLines,
      "",
      "Nutze die Reaktionen unter dieser Nachricht, um Rollen zuzuweisen oder zu entfernen."
    ].join("\n"),
    REACTION_ROLE_EMBED_DESCRIPTION_MAX_LENGTH
  );

  const embed = new EmbedBuilder()
    .setColor(REACTION_ROLE_EMBED_COLOR)
    .setTitle(panelTitle || "Ping-Rollen")
    .setDescription(description)
    .setFooter({ text: "Reaction-Role Panel" });

  const buttonRows = splitIntoChunks(safeEntries.slice(0, REACTION_ROLE_MAX_BUTTONS), 5)
    .slice(0, 5)
    .map((chunk) => {
      const row = new ActionRowBuilder();

      for (const entry of chunk) {
        const button = new ButtonBuilder()
          .setCustomId(toButtonCustomId(entry.roleId))
          .setLabel(truncateText(entry.roleName || `Rolle ${entry.roleId}`, 80))
          .setStyle(ButtonStyle.Secondary);

        const buttonEmoji = mapEntryToButtonEmoji(entry);
        if (buttonEmoji) {
          button.setEmoji(buttonEmoji);
        }

        row.addComponents(button);
      }

      return row;
    });

  return {
    embeds: [embed],
    components: buttonRows,
    allowedMentions: {
      parse: []
    }
  };
}

async function handleReactionRoleButtonInteraction({ client, interaction }) {
  const roleId = getRoleIdFromButtonCustomId(interaction.customId);
  if (!roleId) {
    return;
  }

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "Diese Buttons funktionieren nur auf einem Server.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const messageId = toSnowflake(interaction.message?.id);
  if (!messageId) {
    await interaction.reply({
      content: "Button-Zuordnung ist ungueltig.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const moduleState = client.botContext.moduleConfigStore.getModuleState(interaction.guildId, "reaction-role");
  const bindings = normalizeReactionRoleBindings(moduleState?.config?.bindings);
  const matchedBinding = bindings.find((binding) => binding.messageId === messageId && binding.roleId === roleId);

  if (!matchedBinding) {
    await interaction.reply({
      content: "Diese Rolle ist auf dieser Nachricht nicht konfiguriert.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const member = await resolveGuildMember(interaction.guild, interaction.user.id);
  if (!member) {
    await interaction.reply({
      content: "Mitglied konnte nicht aufgeloest werden.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const role = await resolveGuildRole(interaction.guild, roleId);
  if (!role) {
    await interaction.reply({
      content: "Die verknuepfte Rolle existiert nicht mehr.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const hasRole = member.roles.cache.has(role.id);

  try {
    if (hasRole) {
      await member.roles.remove(role, "Reaction-Role Button: Rolle entfernt");
      await interaction.reply({
        content: `Rolle entfernt: <@&${role.id}>`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await member.roles.add(role, "Reaction-Role Button: Rolle zugewiesen");
    await interaction.reply({
      content: `Rolle zugewiesen: <@&${role.id}>`,
      flags: MessageFlags.Ephemeral
    });
  } catch (error) {
    client.botContext.logger.warn("Reaction-Role Button konnte Rolle nicht togglen", {
      guildId: interaction.guildId,
      userId: interaction.user.id,
      roleId,
      messageId,
      error: String(error)
    });

    await interaction.reply({
      content: "Rolle konnte nicht aktualisiert werden. Bitte Team informieren.",
      flags: MessageFlags.Ephemeral
    });
  }
}

async function handleReactionRoleInteraction({ client, interaction }) {
  if (interaction.isButton() && String(interaction.customId || "").startsWith(REACTION_ROLE_BUTTON_PREFIX)) {
    await handleReactionRoleButtonInteraction({ client, interaction });
    return;
  }

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

  const validEntriesByRoleId = new Map();
  const invalidRoleIds = [];

  for (const entry of entries) {
    const role = await resolveGuildRole(interaction.guild, entry.roleId);
    if (!role) {
      invalidRoleIds.push(entry.roleId);
      continue;
    }

    if (!validEntriesByRoleId.has(role.id)) {
      validEntriesByRoleId.set(role.id, {
        ...entry,
        roleId: role.id,
        roleName: role.name
      });
    }
  }

  const validEntries = Array.from(validEntriesByRoleId.values());

  if (validEntries.length === 0) {
    await interaction.editReply({
      content: "Keine gültigen Rollen gefunden. Bitte nutze Rollen-Erwähnungen oder IDs."
    });
    return;
  }

  if (validEntries.length > REACTION_ROLE_MAX_BUTTONS) {
    await interaction.editReply({
      content: `Zu viele Mappings (${validEntries.length}). Ein Panel unterstützt maximal ${REACTION_ROLE_MAX_BUTTONS} Buttons.`
    });
    return;
  }

  const panelPayload = buildReactionRolePanelPayload(panelTitle, panelText, validEntries);
  const panelMessage = await channel.send(panelPayload).catch(() => null);
  if (!panelMessage) {
    await interaction.editReply({
      content: "Panel-Nachricht konnte nicht gesendet werden. Prüfe Bot-Rechte im Kanal."
    });
    return;
  }

  const moduleState = client.botContext.moduleConfigStore.getModuleState(interaction.guildId, "reaction-role");
  const existingBindings = normalizeReactionRoleBindings(moduleState?.config?.bindings);
  const nextBindings = [...existingBindings];
  let savedMappings = 0;

  for (const entry of validEntries) {
    const binding = {
      channelId: channel.id,
      messageId: panelMessage.id,
      roleId: entry.roleId,
      emojiId: entry?.emoji?.emojiId || "",
      emojiName: entry?.emoji?.emojiName || ""
    };

    const existingIndex = nextBindings.findIndex((item) => (
      item.messageId === binding.messageId && item.roleId === binding.roleId
    ));

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
      "Panel nutzt jetzt Rollen-Buttons statt Reaktionen.",
      invalidRoleIds.length > 0 ? `Ungültige Rollen: ${invalidRoleIds.map((roleId) => `<@&${roleId}>`).join(" ")}` : ""
    ].filter(Boolean).join("\n")
  });
}

export const reactionRoleModule = {
  name: "reaction-role",
  defaultEnabled: false,
  defaultConfig: {
    bindings: []
  },
  commands: [reactionRoleCommand],
  events: {
    interactionCreate: [handleReactionRoleInteraction]
  }
};
