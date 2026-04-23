import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder
} from "discord.js";
import {
  getDepartmentById,
  getDepartmentsFromSettings
} from "../departments/service.js";
import { sendBotPing } from "../logging/logDispatcher.js";

const TICKET_BUTTON_ID = "ticket_open_create";
const TICKET_DEPARTMENT_SELECT_ID = "ticket_select_department";
const TICKET_MODAL_PREFIX = "ticket_modal_create";
const TICKET_ESCALATE_ID = "ticket_escalate";

async function respondEphemeral(interaction, content) {
  const payload = { content, flags: MessageFlags.Ephemeral };

  if (interaction.deferred) {
    await interaction.editReply(payload);
    return;
  }

  if (interaction.replied) {
    await interaction.followUp(payload);
    return;
  }

  await interaction.reply(payload);
}

function ticketPanelEmbed() {
  return new EmbedBuilder()
    .setColor(0x1f6feb)
    .setTitle("Support Ticket erstellen")
    .setDescription(
      [
        "Klicke auf den Button unten.",
        "Danach waehle ein Department im Dropdown.",
        "Anschliessend oeffnet sich das Formular fuer Titel und Beschreibung.",
        "Nur das gewaehlte Department wird gepingt."
      ].join("\n")
    );
}

function ticketPanelRows() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(TICKET_BUTTON_ID)
      .setStyle(ButtonStyle.Primary)
      .setLabel("Ticket erstellen")
  );

  return [row];
}

function buildDepartmentSelectRow(departments) {
  const options = departments.slice(0, 25).map((department) => ({
    label: department.name.slice(0, 100),
    value: department.id,
    description: `${department.roleIds.length} Rollen zugewiesen`.slice(0, 100)
  }));

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(TICKET_DEPARTMENT_SELECT_ID)
      .setPlaceholder("Department fuer dieses Ticket auswaehlen")
      .addOptions(options)
      .setMinValues(1)
      .setMaxValues(1)
  );
}

function buildTicketModal(departmentName, departmentId) {
  const modal = new ModalBuilder()
    .setCustomId(`${TICKET_MODAL_PREFIX}:${departmentId}`)
    .setTitle(`Ticket: ${departmentName}`);

  const titleInput = new TextInputBuilder()
    .setCustomId("ticket_title")
    .setLabel("Titel")
    .setPlaceholder("Kurzer Betreff")
    .setStyle(TextInputStyle.Short)
    .setMinLength(3)
    .setMaxLength(80)
    .setRequired(true);

  const descriptionInput = new TextInputBuilder()
    .setCustomId("ticket_description")
    .setLabel("Beschreibung")
    .setPlaceholder("Beschreibe dein Anliegen moeglichst genau")
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(10)
    .setMaxLength(1000)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(titleInput),
    new ActionRowBuilder().addComponents(descriptionInput)
  );

  return modal;
}

function sanitizeForChannelName(raw) {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function createTicketChannelSlug(departmentName, username) {
  const base = sanitizeForChannelName(username) || "user";
  const dep = sanitizeForChannelName(departmentName) || "support";
  const suffix = Date.now().toString().slice(-4);
  return `${dep}-${base}-${suffix}`;
}

function formatTicketNumber(ticketNumber) {
  return String(ticketNumber).padStart(4, "0");
}

function createTicketControlRows(departments, currentDepartmentId) {
  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_close")
      .setLabel("Ticket schliessen")
      .setStyle(ButtonStyle.Danger)
  );

  const escalationTargets = departments
    .filter((department) => department.id !== currentDepartmentId)
    .slice(0, 25);

  if (escalationTargets.length === 0) {
    return [closeRow];
  }

  const escalateRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(TICKET_ESCALATE_ID)
      .setPlaceholder("Ticket an anderes Department eskalieren")
      .addOptions(
        escalationTargets.map((department) => ({
          label: department.name.slice(0, 100),
          value: department.id,
          description: `An ${department.name} weiterleiten`.slice(0, 100)
        }))
      )
  );

  return [closeRow, escalateRow];
}

function roleMentions(roleIds) {
  return [...new Set((roleIds || []).filter(Boolean))].map((id) => `<@&${id}>`).join(" ");
}

function canManageTicket(member, settings) {
  if (!member) {
    return false;
  }

  const standardTeamRoleId = settings?.standard_team_role_id;
  if (!standardTeamRoleId) {
    return false;
  }

  return member.roles.cache.has(standardTeamRoleId);
}

function resolveExistingRoleIds(guild, roleIds) {
  return [...new Set((roleIds || []).filter((id) => guild.roles.cache.has(id)))];
}

function getTicketCategoryId(guild, settings) {
  if (!settings?.ticket_panel_channel_id) {
    return null;
  }

  const panelChannel = guild.channels.cache.get(settings.ticket_panel_channel_id);
  if (!panelChannel) {
    return null;
  }

  return panelChannel.parentId || null;
}

export function isTicketComponentInteraction(interaction) {
  const customId = interaction.customId || "";
  return (
    customId === TICKET_BUTTON_ID ||
    customId === TICKET_DEPARTMENT_SELECT_ID ||
    customId === "ticket_close" ||
    customId === TICKET_ESCALATE_ID
  );
}

export function isTicketModalInteraction(interaction) {
  const customId = interaction.customId || "";
  return customId.startsWith(`${TICKET_MODAL_PREFIX}:`);
}

export async function ensureTicketPanelPosted(guild, channelId, guildSettingsRepository, logger) {
  const channel = guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null));
  if (!channel || !channel.isTextBased()) {
    throw new Error("Ticket-Panel-Channel ist nicht erreichbar oder nicht textbasiert.");
  }

  const settings = guildSettingsRepository.getByGuildId(guild.id);
  let message = null;

  if (settings?.ticket_panel_message_id) {
    message = await channel.messages.fetch(settings.ticket_panel_message_id).catch(() => null);
  }

  const payload = {
    embeds: [ticketPanelEmbed()],
    components: ticketPanelRows()
  };

  if (message) {
    await message.edit(payload);
    return settings.ticket_panel_message_id;
  }

  const sent = await channel.send(payload);
  guildSettingsRepository.setField(guild.id, "ticket_panel_message_id", sent.id);
  logger.info("Ticket-Panel gepostet oder aktualisiert.", { guildId: guild.id, channelId, messageId: sent.id });
  return sent.id;
}

export async function handleTicketComponent(interaction, guildSettingsRepository, logger) {
  const settings = guildSettingsRepository.getByGuildId(interaction.guildId);
  const departments = getDepartmentsFromSettings(settings);

  if (interaction.isButton() && interaction.customId === TICKET_BUTTON_ID) {
    if (departments.length === 0) {
      await respondEphemeral(
        interaction,
        "Keine Departments konfiguriert. Nutze /department create und /department role-add."
      );
      return;
    }

    await interaction.reply({
      content: "Waehle das Department fuer dein Ticket:",
      components: [buildDepartmentSelectRow(departments)],
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === TICKET_DEPARTMENT_SELECT_ID) {
    const selectedDepartmentId = interaction.values?.[0];
    const department = getDepartmentById(settings, selectedDepartmentId);

    if (!department) {
      await respondEphemeral(interaction, "Das ausgewaehlte Department existiert nicht mehr.");
      return;
    }

    await interaction.showModal(buildTicketModal(department.name, department.id));
    return;
  }

  if (interaction.isButton() && interaction.customId === "ticket_close") {
    if (!canManageTicket(interaction.member, settings)) {
      await interaction.reply({
        content: "Nur Mitglieder mit der Standard-Teamrolle duerfen Tickets schliessen.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.reply({ content: "Ticket wird geschlossen...", flags: MessageFlags.Ephemeral });
    await interaction.channel.delete("Ticket durch Team geschlossen").catch((error) => {
      logger.warn("Ticket konnte nicht geloescht werden.", { guildId: interaction.guildId, error: String(error) });
    });
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === TICKET_ESCALATE_ID) {
    if (!canManageTicket(interaction.member, settings)) {
      await interaction.reply({
        content: "Nur Mitglieder mit der Standard-Teamrolle duerfen Tickets eskalieren.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const selectedDepartmentId = interaction.values?.[0];
    const department = getDepartmentById(settings, selectedDepartmentId);
    if (!department) {
      await respondEphemeral(interaction, "Department fuer Eskalation wurde nicht gefunden.");
      return;
    }

    const roleIds = resolveExistingRoleIds(interaction.guild, department.roleIds || []);
    for (const roleId of roleIds) {
      await interaction.channel.permissionOverwrites.edit(roleId, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true
      });
    }

    const mention = roleMentions(roleIds);
    await interaction.reply({
      content: `Ticket wurde an ${department.name} eskaliert. ${mention}`,
      allowedMentions: { parse: [], roles: roleIds }
    });

    await sendBotPing(
      interaction.guild,
      `:rotating_light: Ticket eskaliert in <#${interaction.channel.id}> an ${department.name}. ${mention}`,
      { allowedMentions: { parse: [], roles: roleIds } }
    );
  }
}

export async function handleTicketModal(interaction, guildSettingsRepository, logger) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
  }

  const departmentId = interaction.customId.split(":")[1] || "";
  const settings = guildSettingsRepository.getByGuildId(interaction.guildId);
  const departments = getDepartmentsFromSettings(settings);
  const department = getDepartmentById(settings, departmentId);

  if (!department) {
    await respondEphemeral(interaction, "Das Department wurde nicht gefunden. Bitte Ticket neu starten.");
    return;
  }

  const ticketTitle = interaction.fields.getTextInputValue("ticket_title").trim();
  const ticketDescription = interaction.fields.getTextInputValue("ticket_description").trim();
  const roleIds = resolveExistingRoleIds(interaction.guild, department.roleIds || []);
  const ticketNumber = guildSettingsRepository.getNextTicketNumber(interaction.guildId);
  const ticketNumberLabel = formatTicketNumber(ticketNumber);

  const ticketChannel = await interaction.guild.channels.create({
    name: `ticket-${ticketNumberLabel}-${createTicketChannelSlug(department.name, interaction.user.username)}`.slice(0, 95),
    type: ChannelType.GuildText,
    parent: getTicketCategoryId(interaction.guild, settings),
    topic: `Ticket #${ticketNumberLabel} von ${interaction.user.tag} | Department: ${department.name}`,
    permissionOverwrites: [
      {
        id: interaction.guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks
        ]
      },
      {
        id: interaction.client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ManageMessages
        ]
      },
      ...roleIds.map((roleId) => ({
        id: roleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory
        ]
      }))
    ],
    reason: `Ticket-Erstellung fuer ${interaction.user.tag}`
  });

  const departmentMention = roleMentions(roleIds);

  await ticketChannel.send({
    content: [
      `Neues Ticket von <@${interaction.user.id}>`,
      departmentMention
    ].filter(Boolean).join("\n"),
    allowedMentions: {
      parse: [],
      users: [interaction.user.id],
      roles: roleIds
    },
    embeds: [
      new EmbedBuilder()
        .setColor(0xb45f06)
        .setTitle(ticketTitle)
        .setDescription(ticketDescription)
        .addFields(
          { name: "Ticket-Nr.", value: `#${ticketNumberLabel}`, inline: true },
          { name: "Department", value: department.name, inline: true },
          { name: "Erstellt von", value: `<@${interaction.user.id}>`, inline: true }
        )
        .setTimestamp(new Date())
    ],
    components: createTicketControlRows(departments, department.id)
  });

  await sendBotPing(
    interaction.guild,
    `:bell: Neues Ticket #${ticketNumberLabel} (${department.name}) erstellt: <#${ticketChannel.id}> von <@${interaction.user.id}> ${departmentMention}`,
    {
      allowedMentions: {
        parse: [],
        users: [interaction.user.id],
        roles: roleIds
      }
    }
  );

  await respondEphemeral(interaction, `Dein Ticket wurde erstellt: <#${ticketChannel.id}>`);

  logger.info("Ticket erstellt.", {
    guildId: interaction.guildId,
    channelId: ticketChannel.id,
    ticketNumber,
    department: department.name,
    userId: interaction.user.id
  });
}
