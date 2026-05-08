import {
  AttachmentBuilder,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits
} from "discord.js";
import { canManageServer } from "../../core/permissions.js";
import { supportDepartmentCommand } from "./commands/supportDepartment.js";
import { supportDepartmentUiCommand } from "./commands/supportDepartmentUi.js";
import { supportTicketPanelCommand } from "./commands/supportTicketPanel.js";
import {
  addSupportCaseAction,
  claimSupportCase,
  closeSupportCase,
  createSupportCase,
  escalateSupportCase,
  getSupportCase,
  getUserActiveCase,
  setCaseManagementMessage
} from "./services/cases.js";
import {
  createUniqueDepartmentId,
  ensureDefaultDepartment,
  ensureValidDefaultDepartmentId,
  extractRoleIds,
  getDepartmentById,
  normalizeDepartments,
  hasDepartmentAccess
} from "./services/config.js";
import {
  SUPPORT_DEPT_UI_ADD_BUTTON_ID,
  SUPPORT_DEPT_UI_ADD_MODAL_ID,
  SUPPORT_DEPT_UI_ADD_NAME_INPUT_ID,
  SUPPORT_DEPT_UI_ADD_ROLES_INPUT_ID,
  SUPPORT_DEPT_UI_REFRESH_BUTTON_ID,
  SUPPORT_DEPT_UI_REMOVE_PREFIX,
  SUPPORT_DEPT_UI_ROLES_INPUT_ID,
  SUPPORT_DEPT_UI_ROLES_MODAL_PREFIX,
  SUPPORT_DEPT_UI_SELECT_ID,
  SUPPORT_DEPT_UI_SET_DEFAULT_PREFIX,
  SUPPORT_DEPT_UI_SET_ROLES_PREFIX,
  buildSupportDepartmentActionsPayload,
  buildSupportDepartmentAddModal,
  buildSupportDepartmentManagementPayload,
  buildSupportDepartmentRolesModal
} from "./services/departmentUi.js";
import {
  buildCaseTranscript,
  buildEscalationSelectPayload,
  buildSupportClaimedMessage,
  buildSupportClosedMessage,
  buildSupportOpenCaseMessage,
  SUPPORT_CLAIM_PREFIX,
  SUPPORT_CLOSE_PREFIX,
  SUPPORT_ESCALATE_PREFIX,
  SUPPORT_ESCALATE_SELECT_PREFIX,
  SUPPORT_TRANSCRIPT_PREFIX
} from "./services/panel.js";
import { ensureSupportDefaults } from "./services/provisioning.js";
import {
  closeSupportTicket,
  createSupportTicket,
  escalateSupportTicket,
  getOpenTicketByUser,
  getSupportTicket
} from "./services/tickets.js";
import {
  buildSupportTicketEscalationSelectPayload,
  buildSupportTicketDepartmentSelectPayload,
  buildSupportTicketOpenMessage,
  SUPPORT_TICKET_DEPARTMENT_SELECT_ID,
  SUPPORT_TICKET_CLOSE_PREFIX,
  SUPPORT_TICKET_DESCRIPTION_INPUT_ID,
  SUPPORT_TICKET_ESCALATE_PREFIX,
  SUPPORT_TICKET_ESCALATE_SELECT_PREFIX,
  SUPPORT_TICKET_NAME_INPUT_ID,
  SUPPORT_TICKET_OPEN_BUTTON_ID,
  SUPPORT_TICKET_OPEN_MODAL_PREFIX,
  buildSupportTicketOpenModal
} from "./services/ticketPanel.js";

async function resolveGuildMember(guild, userId) {
  return guild.members.cache.get(userId)
    || (await guild.members.fetch(userId).catch(() => null));
}

async function resolveVoiceChannel(guild, channelId) {
  if (!channelId) {
    return null;
  }

  const channel = guild.channels.cache.get(channelId)
    || (await guild.channels.fetch(channelId).catch(() => null));

  if (!channel || channel.type !== ChannelType.GuildVoice) {
    return null;
  }

  return channel;
}

async function resolveTextChannel(guild, channelId) {
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

async function resolveTranscriptChannel(guild, config) {
  const preferredChannel = await resolveTextChannel(guild, config.transcriptTextChannelId);
  if (preferredChannel) {
    return preferredChannel;
  }

  const managementChannel = await resolveTextChannel(guild, config.managementChannelId);
  if (managementChannel) {
    return managementChannel;
  }

  return null;
}

async function resolveExistingRoleIds(guild, roleIds) {
  const source = Array.isArray(roleIds) ? roleIds : [];
  const validRoleIds = [];

  for (const roleId of source) {
    const role = guild.roles.cache.get(roleId) || (await guild.roles.fetch(roleId).catch(() => null));
    if (role) {
      validRoleIds.push(role.id);
    }
  }

  return [...new Set(validRoleIds)];
}

function toChannelSlug(input, fallback = "ticket", maxLength = 24) {
  const normalized = String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLength);

  return normalized || fallback;
}

function buildTicketChannelName(user, department, ticketName) {
  const ticketPart = toChannelSlug(ticketName, "anliegen", 24);
  const departmentPart = toChannelSlug(department?.name, "support", 18);
  const idPart = String(user?.id || "xxxx").slice(-4);
  return `ticket-${departmentPart}-${ticketPart}-${idPart}`.slice(0, 100);
}

async function createTicketChannel({ guild, user, department, config, logger, ticketName }) {
  const isMissingPermissionsError = (error) => {
    const apiCode = error?.code;
    return apiCode === 50013 || String(error || "").includes("Missing Permissions");
  };

  const roleIds = Array.isArray(department?.roleIds) ? department.roleIds : [];
  const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
  const canManageChannels = Boolean(me?.permissions?.has(PermissionFlagsBits.ManageChannels));
  const canManageRoles = Boolean(me?.permissions?.has(PermissionFlagsBits.ManageRoles));
  const isAdministrator = Boolean(me?.permissions?.has(PermissionFlagsBits.Administrator));

  if (!canManageChannels) {
    logger.warn("Ticket-Channel konnte nicht erstellt werden: fehlende Rechte", {
      guildId: guild.id,
      requiredPermission: "ManageChannels",
      botPermissions: {
        administrator: isAdministrator,
        manageChannels: canManageChannels,
        manageRoles: canManageRoles
      }
    });

    return {
      channel: null,
      errorCode: "missing_manage_channels"
    };
  }

  if (!canManageRoles) {
    logger.warn("Ticket-Channel konnte nicht erstellt werden: fehlende Rechte für private Overwrites", {
      guildId: guild.id,
      requiredPermission: "ManageRoles",
      botPermissions: {
        administrator: isAdministrator,
        manageChannels: canManageChannels,
        manageRoles: canManageRoles
      }
    });

    return {
      channel: null,
      errorCode: "missing_manage_roles"
    };
  }

  let parentCategoryId = null;
  if (config.ticketCategoryId) {
    const parent = guild.channels.cache.get(config.ticketCategoryId)
      || (await guild.channels.fetch(config.ticketCategoryId).catch(() => null));

    if (parent && parent.type === ChannelType.GuildCategory) {
      const parentPerms = parent.permissionsFor(me);
      const canUseParent = parentPerms
        && parentPerms.has(PermissionFlagsBits.ViewChannel)
        && parentPerms.has(PermissionFlagsBits.ManageChannels);

      if (canUseParent) {
        parentCategoryId = parent.id;
      } else {
        logger.warn("Ticket-Kategorie kann nicht verwendet werden, fallback ohne Kategorie", {
          guildId: guild.id,
          categoryId: parent.id
        });
      }
    }
  }

  const validRoleIds = [];
  for (const roleId of roleIds) {
    const role = guild.roles.cache.get(roleId) || (await guild.roles.fetch(roleId).catch(() => null));
    if (role) {
      validRoleIds.push(role.id);
    }
  }

  const basePermissionOverwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    {
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory
      ]
    }
  ];

  basePermissionOverwrites.push({
    id: me.id,
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory
    ]
  });

  const departmentPermissionOverwrites = [];
  for (const roleId of validRoleIds) {
    departmentPermissionOverwrites.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory
      ]
    });
  }

  const attempts = [
    {
      id: "category_with_department_roles",
      parent: parentCategoryId,
      permissionOverwrites: [...basePermissionOverwrites, ...departmentPermissionOverwrites]
    },
    {
      id: "root_with_department_roles",
      parent: null,
      permissionOverwrites: [...basePermissionOverwrites, ...departmentPermissionOverwrites]
    },
    {
      id: "root_minimal_permissions",
      parent: null,
      permissionOverwrites: [...basePermissionOverwrites]
    }
  ];

  let lastError = null;

  for (const attempt of attempts) {
    try {
      const channel = await guild.channels.create({
        name: buildTicketChannelName(user, department, ticketName),
        type: ChannelType.GuildText,
        parent: attempt.parent,
        topic: `Support-Ticket für ${user.id} | Department: ${department?.id || "unbekannt"} | Titel: ${ticketName}`.slice(0, 1024),
        permissionOverwrites: attempt.permissionOverwrites,
        reason: `Support-Ticket erstellt von ${user.id}`
      });

      return {
        channel,
        errorCode: ""
      };
    } catch (error) {
      lastError = error;

      logger.warn("Ticket-Channel-Erstellung fehlgeschlagen (Retry folgt)", {
        guildId: guild.id,
        userId: user.id,
        departmentId: department?.id || "",
        attempt: attempt.id,
        error: String(error)
      });
    }
  }

  return {
    channel: null,
    errorCode: isMissingPermissionsError(lastError) ? "missing_permissions_discord" : "create_failed"
  };
}

async function findFreeTalkChannel(guild, config, logger) {
  const talkIds = Array.isArray(config.talkChannelIds) ? config.talkChannelIds : [];

  for (const channelId of talkIds) {
    const channel = await resolveVoiceChannel(guild, channelId);
    if (!channel) {
      continue;
    }

    const nonBotMemberCount = channel.members.filter((member) => !member.user.bot).size;
    if (nonBotMemberCount === 0) {
      return channel;
    }
  }

  const talkCategoryId = config.talkCategoryId || null;
  const parent = talkCategoryId ? guild.channels.cache.get(talkCategoryId) : null;

  try {
    return await guild.channels.create({
      name: `support-talk-${talkIds.length + 1}`,
      type: ChannelType.GuildVoice,
      parent: parent?.id || null,
      reason: "Zusätzlicher freier Support-Talk wurde benötigt"
    });
  } catch (error) {
    logger.warn("Zusätzlicher Support-Talk konnte nicht erstellt werden", {
      guildId: guild.id,
      error: String(error)
    });
    return null;
  }
}

function getSupportConfig(moduleConfigStore, guildId, env) {
  const supportState = moduleConfigStore.getModuleState(guildId, "support");
  const currentConfig = supportState?.config || {};

  const departments = ensureDefaultDepartment(
    currentConfig.departments,
    env.supportDefaultDepartmentName,
    []
  );

  const defaultDepartmentId = ensureValidDefaultDepartmentId(departments, currentConfig.defaultDepartmentId);

  return {
    ...currentConfig,
    departments,
    defaultDepartmentId
  };
}

async function updateCaseMessage(guild, caseData, config) {
  const managementChannel = await resolveTextChannel(guild, config.managementChannelId);
  if (!managementChannel || !caseData.managementMessageId) {
    return;
  }

  const department = getDepartmentById(config.departments, caseData.departmentId);
  const message = await managementChannel.messages.fetch(caseData.managementMessageId).catch(() => null);
  if (!message) {
    return;
  }

  if (caseData.status === "closed") {
    await message.edit(buildSupportClosedMessage(caseData, department));
    return;
  }

  if (caseData.status === "claimed") {
    await message.edit(buildSupportClaimedMessage(caseData, department));
    return;
  }

  await message.edit(buildSupportOpenCaseMessage(caseData, department));
}

async function handleVoiceJoinWaitingRoom({ client, newState, oldState }) {
  const member = newState.member;
  if (!member || member.user.bot || !newState.guild) {
    return;
  }

  if (oldState.channelId === newState.channelId) {
    return;
  }

  const { moduleConfigStore, logger, env } = client.botContext;
  const config = getSupportConfig(moduleConfigStore, newState.guild.id, env);

  if (!config.waitingChannelId || !config.managementChannelId) {
    return;
  }

  if (newState.channelId !== config.waitingChannelId) {
    return;
  }

  const existingCase = getUserActiveCase(newState.guild.id, member.id);
  if (existingCase) {
    let shouldCloseStaleCase = false;
    let staleReason = "";

    if (existingCase.status === "claimed") {
      const talkChannel = await resolveVoiceChannel(newState.guild, existingCase.talkChannelId);
      const userInTalk = Boolean(talkChannel?.members?.has(member.id));
      const supporterInTalk = existingCase.supporterId
        ? Boolean(talkChannel?.members?.has(existingCase.supporterId))
        : false;

      if (!talkChannel || !userInTalk || !supporterInTalk) {
        shouldCloseStaleCase = true;
        staleReason = "System: Verwaister geclaimter Fall wurde beim erneuten Warteraum-Join automatisch geschlossen";
      }
    }

    if (existingCase.status === "open" && !shouldCloseStaleCase) {
      const managementChannel = await resolveTextChannel(newState.guild, config.managementChannelId);
      const hasManagementMessage = existingCase.managementMessageId && managementChannel
        ? Boolean(await managementChannel.messages.fetch(existingCase.managementMessageId).catch(() => null))
        : false;

      if (!hasManagementMessage) {
        shouldCloseStaleCase = true;
        staleReason = "System: Verwaister offener Fall ohne Management-Nachricht wurde automatisch geschlossen";
      }
    }

    if (!shouldCloseStaleCase) {
      return;
    }

    addSupportCaseAction(newState.guild.id, existingCase.id, staleReason);
    const closedCase = closeSupportCase(newState.guild.id, existingCase.id, "system");
    if (closedCase) {
      await updateCaseMessage(newState.guild, closedCase, config);
    }
  }

  const { caseData, created } = createSupportCase({
    guildId: newState.guild.id,
    userId: member.id,
    departmentId: config.defaultDepartmentId,
    waitingChannelId: config.waitingChannelId,
    managementChannelId: config.managementChannelId
  });

  if (!created) {
    return;
  }

  const department = getDepartmentById(config.departments, caseData.departmentId);
  const managementChannel = await resolveTextChannel(newState.guild, config.managementChannelId);
  const sanitizedDepartment = department
    ? {
      ...department,
      roleIds: await resolveExistingRoleIds(newState.guild, department.roleIds)
    }
    : null;

  if (!managementChannel) {
    logger.warn("Support-Fall konnte nicht in Verwaltungskanal gepostet werden", {
      guildId: newState.guild.id,
      caseId: caseData.id
    });

    addSupportCaseAction(
      newState.guild.id,
      caseData.id,
      "System: Fall wurde automatisch geschlossen, da der Verwaltungskanal nicht verfügbar ist"
    );
    closeSupportCase(newState.guild.id, caseData.id, "system");
    return;
  }

  try {
    const message = await managementChannel.send(buildSupportOpenCaseMessage(caseData, sanitizedDepartment));
    setCaseManagementMessage(newState.guild.id, caseData.id, message.id);
  } catch (error) {
    logger.warn("Support-Fall konnte nicht mit Rollen-Ping gepostet werden, versuche Fallback", {
      guildId: newState.guild.id,
      caseId: caseData.id,
      error: String(error)
    });

    const fallbackPayload = buildSupportOpenCaseMessage(caseData, sanitizedDepartment);
    fallbackPayload.content = `Neuer Supportfall von <@${caseData.userId}>`;
    fallbackPayload.allowedMentions = { parse: [] };

    try {
      const fallbackMessage = await managementChannel.send(fallbackPayload);
      setCaseManagementMessage(newState.guild.id, caseData.id, fallbackMessage.id);
      addSupportCaseAction(
        newState.guild.id,
        caseData.id,
        "System: Rollen-Ping fehlgeschlagen, Fallback ohne Ping gesendet"
      );
      return;
    } catch (fallbackError) {
      logger.warn("Support-Fall konnte auch im Fallback nicht gepostet werden", {
        guildId: newState.guild.id,
        caseId: caseData.id,
        error: String(fallbackError)
      });
    }

    addSupportCaseAction(
      newState.guild.id,
      caseData.id,
      "System: Fall wurde automatisch geschlossen, da die Fallnachricht nicht erstellt werden konnte"
    );
    closeSupportCase(newState.guild.id, caseData.id, "system");
  }
}

async function handleVoiceDisconnectWaitingRoom({ client, oldState, newState }) {
  const member = oldState.member;
  if (!member || member.user.bot || !oldState.guild) {
    return;
  }

  if (oldState.channelId === newState.channelId) {
    return;
  }

  const { moduleConfigStore, env } = client.botContext;
  const config = getSupportConfig(moduleConfigStore, oldState.guild.id, env);

  if (!config.waitingChannelId || oldState.channelId !== config.waitingChannelId) {
    return;
  }

  if (newState.channelId) {
    return;
  }

  const activeCase = getUserActiveCase(oldState.guild.id, member.id);
  if (!activeCase || activeCase.status === "closed") {
    return;
  }

  addSupportCaseAction(
    oldState.guild.id,
    activeCase.id,
    "System: Fall wurde automatisch geschlossen, da der Nutzer den Warteraum verlassen hat"
  );

  const closedCase = closeSupportCase(oldState.guild.id, activeCase.id, "system");
  if (!closedCase) {
    return;
  }

  await updateCaseMessage(oldState.guild, closedCase, config);
}

function canHandleCase(interaction, caseData) {
  if (!interaction.member || !caseData) {
    return false;
  }

  if (canManageServer(interaction.member)) {
    return true;
  }

  return caseData.supporterId === interaction.user.id;
}

function canHandleTicket(interaction, ticket, department) {
  if (!interaction.member || !ticket) {
    return false;
  }

  if (canManageServer(interaction.member)) {
    return true;
  }

  if (ticket.userId === interaction.user.id) {
    return true;
  }

  if (!department) {
    return false;
  }

  return hasDepartmentAccess(interaction.member, department);
}

function canEscalateCase(interaction, department) {
  if (!interaction.member || !department) {
    return false;
  }

  return hasDepartmentAccess(interaction.member, department);
}

function canEscalateTicket(interaction, department) {
  if (!interaction.member || !department) {
    return false;
  }

  return hasDepartmentAccess(interaction.member, department);
}

async function buildTicketTranscriptContent(ticketChannel, ticket, departmentName) {
  const collected = [];
  let before;

  for (let index = 0; index < 10; index += 1) {
    const fetched = await ticketChannel.messages.fetch({
      limit: 100,
      before
    }).catch(() => null);

    if (!fetched || fetched.size === 0) {
      break;
    }

    collected.push(...fetched.values());

    const lastMessage = fetched.last();
    if (!lastMessage) {
      break;
    }

    before = lastMessage.id;
  }

  const ordered = collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const lines = [
    `Ticket: ${ticket.id}`,
    `Status: ${ticket.status}`,
    `Nutzer: ${ticket.userId}`,
    `Department: ${departmentName || ticket.departmentId}`,
    `Channel: ${ticket.channelId}`,
    `Titel: ${ticket.ticketName || "-"}`,
    `Erstellt: ${ticket.createdAt ? new Date(ticket.createdAt).toISOString() : "-"}`,
    `Geschlossen: ${ticket.closedAt ? new Date(ticket.closedAt).toISOString() : "-"}`,
    `Geschlossen von: ${ticket.closedById || "-"}`,
    "",
    "Beschreibung:",
    ticket.ticketDescription || "-",
    "",
    "Nachrichtenverlauf:"
  ];

  for (const message of ordered) {
    const author = message.author?.tag || message.author?.username || message.author?.id || "Unbekannt";
    const timestamp = message.createdAt ? message.createdAt.toISOString() : new Date().toISOString();
    const content = (message.content || "").trim();
    const text = content || "(kein Text)";

    lines.push(`[${timestamp}] ${author}: ${text}`);

    if (message.attachments.size > 0) {
      const files = Array.from(message.attachments.values())
        .map((file) => file.url)
        .join(" | ");
      lines.push(`  Anhänge: ${files}`);
    }

    if (message.embeds.length > 0) {
      lines.push(`  Embeds: ${message.embeds.length}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function postTicketTranscript({ interaction, ticket, config, departmentName }) {
  const ticketChannel = interaction.channel && interaction.channel.type === ChannelType.GuildText
    ? interaction.channel
    : (await resolveTextChannel(interaction.guild, ticket.channelId));

  if (!ticketChannel) {
    return false;
  }

  const transcriptChannel = await resolveTranscriptChannel(interaction.guild, config);

  if (!transcriptChannel) {
    return false;
  }

  const transcriptContent = await buildTicketTranscriptContent(ticketChannel, ticket, departmentName);
  const attachment = new AttachmentBuilder(Buffer.from(transcriptContent, "utf8"), {
    name: `support-ticket-${ticket.id}.txt`
  });

  const sentMessage = await transcriptChannel.send({
    content: `Transkript für Ticket ${ticket.id} (geschlossen von <@${ticket.closedById || "system"}>)`,
    files: [attachment],
    allowedMentions: {
      parse: []
    }
  }).catch(() => null);

  return Boolean(sentMessage);
}

async function handleClaimInteraction({ client, interaction, caseId }) {
  const { moduleConfigStore, env } = client.botContext;
  const config = getSupportConfig(moduleConfigStore, interaction.guildId, env);
  const caseData = getSupportCase(interaction.guildId, caseId);

  if (!caseData || caseData.status !== "open") {
    await interaction.reply({
      content: "Dieser Fall ist nicht mehr offen.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const department = getDepartmentById(config.departments, caseData.departmentId);
  if (!hasDepartmentAccess(interaction.member, department) && !canManageServer(interaction.member)) {
    await interaction.reply({
      content: "Du hast keine Berechtigung für dieses Department.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const supporterMember = await resolveGuildMember(interaction.guild, interaction.user.id);
  if (!supporterMember?.voice?.channelId) {
    await interaction.reply({
      content: "Bitte zuerst einem Voice-Channel beitreten, dann den Fall claimen.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const userMember = await resolveGuildMember(interaction.guild, caseData.userId);
  if (!userMember?.voice?.channelId) {
    await interaction.reply({
      content: "Der Nutzer ist aktuell nicht in einem Voice-Channel.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const talkChannel = await findFreeTalkChannel(interaction.guild, config, client.botContext.logger);
  if (!talkChannel) {
    await interaction.reply({
      content: "Kein freier Talk-Channel verfügbar und es konnte kein neuer erstellt werden.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  let movedSuccessfully = true;
  await Promise.all([
    supporterMember.voice.setChannel(talkChannel, "Support-Fall geclaimed"),
    userMember.voice.setChannel(talkChannel, "Support-Fall geclaimed")
  ]).catch(async () => {
    movedSuccessfully = false;
    await interaction.reply({
      content: "Verschieben in den Talk-Channel fehlgeschlagen. Prüfe Bot-Rechte (Mitglieder verschieben).",
      flags: MessageFlags.Ephemeral
    });
  });

  if (!movedSuccessfully) {
    return;
  }

  const claimedCase = claimSupportCase(interaction.guildId, caseId, interaction.user.id, talkChannel.id);
  if (!claimedCase) {
    return;
  }

  await updateCaseMessage(interaction.guild, claimedCase, config);

  if (!interaction.replied && !interaction.deferred) {
    await interaction.reply({
      content: `Fall übernommen. Nutzer und Supporter wurden nach <#${talkChannel.id}> verschoben.`,
      flags: MessageFlags.Ephemeral
    });
  }
}

async function handleEscalateInteraction({ client, interaction, caseId }) {
  const caseData = getSupportCase(interaction.guildId, caseId);

  if (!caseData || caseData.status !== "claimed") {
    await interaction.reply({
      content: "Eskalation ist nur bei aktiven Fällen möglich.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const config = getSupportConfig(client.botContext.moduleConfigStore, interaction.guildId, client.botContext.env);
  const currentDepartment = getDepartmentById(config.departments, caseData.departmentId);

  if (!canEscalateCase(interaction, currentDepartment)) {
    await interaction.reply({
      content: "Nur Mitglieder des aktuellen Departments dürfen diesen Fall eskalieren.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const departments = config.departments || [];

  if (departments.length <= 1) {
    await interaction.reply({
      content: "Es gibt kein weiteres Department für eine Eskalation.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.reply({
    ...buildEscalationSelectPayload(caseData, departments),
    flags: MessageFlags.Ephemeral
  });
}

async function handleEscalationSelectInteraction({ client, interaction, caseId }) {
  const caseData = getSupportCase(interaction.guildId, caseId);

  if (!caseData || caseData.status === "closed") {
    await interaction.reply({
      content: "Dieser Fall ist nicht mehr aktiv.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const config = getSupportConfig(client.botContext.moduleConfigStore, interaction.guildId, client.botContext.env);
  const currentDepartment = getDepartmentById(config.departments, caseData.departmentId);

  if (!canEscalateCase(interaction, currentDepartment)) {
    await interaction.reply({
      content: "Nur Mitglieder des aktuellen Departments dürfen diesen Fall eskalieren.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const selectedDepartmentId = interaction.values?.[0] || "";
  const selectedDepartment = getDepartmentById(config.departments, selectedDepartmentId);

  if (!selectedDepartment) {
    await interaction.reply({
      content: "Gewähltes Department wurde nicht gefunden.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const escalatedCase = escalateSupportCase(interaction.guildId, caseId, selectedDepartmentId, interaction.user.id);
  if (!escalatedCase) {
    return;
  }

  const managementChannel = await resolveTextChannel(interaction.guild, config.managementChannelId);
  if (managementChannel) {
    const validRoleIds = await resolveExistingRoleIds(interaction.guild, selectedDepartment.roleIds);
    const pingMentions = validRoleIds.length > 0
      ? validRoleIds.map((roleId) => `<@&${roleId}>`).join(" ")
      : "@here";

    await managementChannel.send({
      content: `${pingMentions}\nFall ${caseId} wurde eskaliert von <@${interaction.user.id}> auf ${selectedDepartment.name}.`,
      allowedMentions: {
        parse: validRoleIds.length > 0 ? [] : ["everyone"],
        roles: validRoleIds
      }
    });
  }

  await updateCaseMessage(interaction.guild, escalatedCase, config);

  await interaction.update({
    content: `Eskalation durchgeführt: ${selectedDepartment.name}`,
    components: []
  });
}

async function handleCloseInteraction({ client, interaction, caseId }) {
  const caseData = getSupportCase(interaction.guildId, caseId);

  if (!caseData || caseData.status === "closed") {
    await interaction.reply({
      content: "Dieser Fall ist bereits geschlossen.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!canHandleCase(interaction, caseData)) {
    await interaction.reply({
      content: "Du darfst diesen Fall nicht schließen.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const userMember = await resolveGuildMember(interaction.guild, caseData.userId);
  const supporterMember = caseData.supporterId
    ? await resolveGuildMember(interaction.guild, caseData.supporterId)
    : null;

  await Promise.all([
    userMember?.voice?.setChannel(null, "Support-Fall geschlossen").catch(() => null),
    supporterMember?.voice?.setChannel(null, "Support-Fall geschlossen").catch(() => null)
  ]);

  const closedCase = closeSupportCase(interaction.guildId, caseId, interaction.user.id);
  if (!closedCase) {
    return;
  }

  const config = getSupportConfig(client.botContext.moduleConfigStore, interaction.guildId, client.botContext.env);
  await updateCaseMessage(interaction.guild, closedCase, config);

  await interaction.reply({
    content: "Fall wurde geschlossen. Nutzer und Supporter wurden aus Voice entfernt.",
    flags: MessageFlags.Ephemeral
  });
}

async function handleTranscriptInteraction({ client, interaction, caseId }) {
  const caseData = getSupportCase(interaction.guildId, caseId);
  if (!caseData || caseData.status === "closed") {
    await interaction.reply({
      content: "Transkript nur für aktive Fälle verfügbar.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!canHandleCase(interaction, caseData)) {
    await interaction.reply({
      content: "Du darfst dieses Transkript nicht erstellen.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  addSupportCaseAction(interaction.guildId, caseId, `Transkript angefordert von ${interaction.user.id}`);
  const config = getSupportConfig(client.botContext.moduleConfigStore, interaction.guildId, client.botContext.env);
  const department = getDepartmentById(config.departments, caseData.departmentId);
  const transcriptContent = buildCaseTranscript(caseData, department?.name || "");

  const transcriptChannel = await resolveTranscriptChannel(interaction.guild, config);

  if (!transcriptChannel) {
    await interaction.reply({
      content: "Transkript-Channel ist nicht verfügbar.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const attachment = new AttachmentBuilder(Buffer.from(transcriptContent, "utf8"), {
    name: `support-case-${caseId}.txt`
  });

  await transcriptChannel.send({
    content: `Transkript für Fall ${caseId} (angefordert von <@${interaction.user.id}>)`,
    files: [attachment]
  });

  await interaction.reply({
    content: "Transkript wurde erstellt und im Verwaltungs-Channel gepostet.",
    flags: MessageFlags.Ephemeral
  });
}

async function handleTicketOpenButtonInteraction({ client, interaction }) {
  const supportState = client.botContext.moduleConfigStore.getModuleState(interaction.guildId, "support");
  const config = supportState?.config || {};
  const departments = normalizeDepartments(config.departments);

  if (departments.length === 0) {
    await interaction.reply({
      content: "Es sind aktuell keine Departments konfiguriert.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.reply({
    ...buildSupportTicketDepartmentSelectPayload(departments),
    flags: MessageFlags.Ephemeral
  });
}

async function handleTicketDepartmentSelectInteraction({ client, interaction }) {
  const selectedDepartmentId = interaction.values?.[0] || "";
  if (!selectedDepartmentId) {
    await interaction.reply({
      content: "Bitte wähle ein gültiges Department aus.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const supportState = client.botContext.moduleConfigStore.getModuleState(interaction.guildId, "support");
  const config = supportState?.config || {};
  const department = getDepartmentById(config.departments, selectedDepartmentId);

  if (!department) {
    await interaction.reply({
      content: "Das gewählte Department wurde nicht gefunden.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.showModal(buildSupportTicketOpenModal(department.id, department.name));
}

function getDepartmentIdFromModalCustomId(customId) {
  if (!customId.startsWith(SUPPORT_TICKET_OPEN_MODAL_PREFIX)) {
    return "";
  }

  return customId.slice(SUPPORT_TICKET_OPEN_MODAL_PREFIX.length);
}

async function handleTicketOpenModalInteraction({ client, interaction }) {
  const departmentId = getDepartmentIdFromModalCustomId(interaction.customId || "");
  if (!departmentId) {
    await interaction.reply({
      content: "Ungültige Ticket-Anfrage. Bitte erneut versuchen.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const ticketName = interaction.fields.getTextInputValue(SUPPORT_TICKET_NAME_INPUT_ID)?.trim() || "";
  const ticketDescription = interaction.fields.getTextInputValue(SUPPORT_TICKET_DESCRIPTION_INPUT_ID)?.trim() || "";

  if (!ticketName || !ticketDescription) {
    await interaction.reply({
      content: "Bitte gib einen Ticket-Namen und eine Beschreibung an.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const { moduleConfigStore, env, logger } = client.botContext;
  const config = getSupportConfig(moduleConfigStore, interaction.guildId, env);
  const department = getDepartmentById(config.departments, departmentId);

  if (!department) {
    await interaction.reply({
      content: "Das gewählte Department wurde nicht gefunden.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const activeTicket = getOpenTicketByUser(interaction.guildId, interaction.user.id);
  if (activeTicket) {
    const existingChannel = await resolveTextChannel(interaction.guild, activeTicket.channelId);
    if (existingChannel) {
      await interaction.reply({
        content: `Du hast bereits ein offenes Ticket: <#${activeTicket.channelId}>`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    closeSupportTicket(interaction.guildId, activeTicket.id, "system");
  }

  const ticketChannelResult = await createTicketChannel({
    guild: interaction.guild,
    user: interaction.user,
    department,
    config,
    logger,
    ticketName
  });

  const ticketChannel = ticketChannelResult?.channel || null;

  if (!ticketChannel) {
    if (ticketChannelResult?.errorCode === "missing_manage_channels") {
      await interaction.reply({
        content: "Ticket konnte nicht erstellt werden: Dem Bot fehlt die Berechtigung `Kanäle verwalten`.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (ticketChannelResult?.errorCode === "missing_manage_roles") {
      await interaction.reply({
        content: "Ticket konnte nicht erstellt werden: Dem Bot fehlt die Berechtigung `Rollen verwalten` für private Ticket-Rechte.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (ticketChannelResult?.errorCode === "missing_permissions_discord") {
      await interaction.reply({
        content: "Ticket konnte nicht erstellt werden: Dem Bot fehlen Rechte im Zielbereich (Kategorie/Channel-Rechte). Bitte Bot-Rollenrechte und Kategorie-Berechtigungen prüfen.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.reply({
      content: "Ticket konnte nicht erstellt werden. Bitte Team informieren.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const { ticket, created } = createSupportTicket({
    guildId: interaction.guildId,
    channelId: ticketChannel.id,
    userId: interaction.user.id,
    departmentId: department.id,
    ticketName,
    ticketDescription
  });

  if (!created || !ticket) {
    await ticketChannel.delete("Ticket konnte nicht gespeichert werden").catch(() => null);

    const existingTicket = getOpenTicketByUser(interaction.guildId, interaction.user.id);
    if (existingTicket) {
      await interaction.reply({
        content: `Du hast bereits ein offenes Ticket: <#${existingTicket.channelId}>`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.reply({
      content: "Ticket konnte nicht gespeichert werden. Bitte Team informieren.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await ticketChannel.send(buildSupportTicketOpenMessage(ticket, department));

  const managementChannel = await resolveTextChannel(interaction.guild, config.managementChannelId);
  if (managementChannel) {
    await managementChannel.send({
      content: `Neues Ticket ${ticket.id} von <@${ticket.userId}> im Department ${department.name}: <#${ticket.channelId}>\nTitel: ${ticket.ticketName}`,
      allowedMentions: {
        parse: []
      }
    });
  }

  await interaction.reply({
    content: `Dein Ticket wurde erstellt: <#${ticket.channelId}>`,
    flags: MessageFlags.Ephemeral
  });
}

async function handleTicketEscalateInteraction({ client, interaction, ticketId }) {
  const ticket = getSupportTicket(interaction.guildId, ticketId);
  if (!ticket || ticket.status !== "open") {
    await interaction.reply({
      content: "Dieses Ticket ist bereits geschlossen oder ungültig.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const config = getSupportConfig(client.botContext.moduleConfigStore, interaction.guildId, client.botContext.env);
  const departments = normalizeDepartments(config.departments);
  const currentDepartment = getDepartmentById(departments, ticket.departmentId);

  if (!canEscalateTicket(interaction, currentDepartment)) {
    await interaction.reply({
      content: "Nur Mitglieder des aktuellen Departments dürfen dieses Ticket eskalieren.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const alternativeDepartments = departments.filter((department) => department.id !== ticket.departmentId);
  if (alternativeDepartments.length === 0) {
    await interaction.reply({
      content: "Es gibt kein weiteres Department für die Eskalation.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.reply({
    ...buildSupportTicketEscalationSelectPayload(ticket, departments),
    flags: MessageFlags.Ephemeral
  });
}

async function handleTicketEscalationSelectInteraction({ client, interaction, ticketId }) {
  const ticket = getSupportTicket(interaction.guildId, ticketId);
  if (!ticket || ticket.status !== "open") {
    await interaction.reply({
      content: "Dieses Ticket ist bereits geschlossen oder ungültig.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const selectedDepartmentId = interaction.values?.[0] || "";
  const config = getSupportConfig(client.botContext.moduleConfigStore, interaction.guildId, client.botContext.env);
  const departments = normalizeDepartments(config.departments);
  const currentDepartment = getDepartmentById(departments, ticket.departmentId);

  if (!canEscalateTicket(interaction, currentDepartment)) {
    await interaction.reply({
      content: "Nur Mitglieder des aktuellen Departments dürfen dieses Ticket eskalieren.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!selectedDepartmentId || selectedDepartmentId === ticket.departmentId) {
    await interaction.update({
      content: "Bitte wähle ein anderes Department.",
      components: []
    });
    return;
  }

  const selectedDepartment = getDepartmentById(departments, selectedDepartmentId);
  if (!selectedDepartment) {
    await interaction.reply({
      content: "Gewähltes Department wurde nicht gefunden.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const escalatedTicket = escalateSupportTicket(interaction.guildId, ticket.id, selectedDepartmentId);
  if (!escalatedTicket || escalatedTicket.status !== "open") {
    await interaction.reply({
      content: "Ticket konnte nicht eskaliert werden.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const ticketChannel = interaction.channel && interaction.channel.type === ChannelType.GuildText
    ? interaction.channel
    : (await resolveTextChannel(interaction.guild, ticket.channelId));

  if (ticketChannel) {
    const currentRoleIds = await resolveExistingRoleIds(interaction.guild, currentDepartment?.roleIds || []);
    const nextRoleIds = await resolveExistingRoleIds(interaction.guild, selectedDepartment.roleIds || []);

    for (const roleId of currentRoleIds) {
      if (!nextRoleIds.includes(roleId)) {
        await ticketChannel.permissionOverwrites.delete(roleId).catch(() => null);
      }
    }

    for (const roleId of nextRoleIds) {
      await ticketChannel.permissionOverwrites.edit(roleId, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true
      }).catch(() => null);
    }

    const pingMentions = nextRoleIds.length > 0
      ? nextRoleIds.map((roleId) => `<@&${roleId}>`).join(" ")
      : "@here";

    await ticketChannel.send({
      content: `${pingMentions}\nTicket ${ticket.id} wurde von <@${interaction.user.id}> auf ${selectedDepartment.name} eskaliert.`,
      allowedMentions: {
        parse: nextRoleIds.length > 0 ? [] : ["everyone"],
        roles: nextRoleIds
      }
    }).catch(() => null);
  }

  const managementChannel = await resolveTextChannel(interaction.guild, config.managementChannelId);
  if (managementChannel) {
    await managementChannel.send({
      content: `Ticket ${ticket.id} wurde von <@${interaction.user.id}> auf ${selectedDepartment.name} eskaliert: <#${ticket.channelId}>`,
      allowedMentions: {
        parse: []
      }
    }).catch(() => null);
  }

  await interaction.update({
    content: `Ticket wurde eskaliert auf ${selectedDepartment.name}.`,
    components: []
  });
}

async function handleTicketCloseInteraction({ client, interaction, ticketId }) {
  const ticket = getSupportTicket(interaction.guildId, ticketId);
  if (!ticket || ticket.status !== "open") {
    await interaction.reply({
      content: "Dieses Ticket ist bereits geschlossen oder ungültig.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const config = getSupportConfig(client.botContext.moduleConfigStore, interaction.guildId, client.botContext.env);
  const department = getDepartmentById(config.departments, ticket.departmentId);

  if (!canHandleTicket(interaction, ticket, department)) {
    await interaction.reply({
      content: "Du darfst dieses Ticket nicht schließen.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const closedTicket = closeSupportTicket(interaction.guildId, ticket.id, interaction.user.id);
  if (!closedTicket) {
    await interaction.reply({
      content: "Dieses Ticket ist nicht mehr offen.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.update({
    content: `Ticket wurde geschlossen von <@${interaction.user.id}>.`,
    components: []
  });

  const ticketChannel = interaction.channel && interaction.channel.type === ChannelType.GuildText
    ? interaction.channel
    : (await resolveTextChannel(interaction.guild, ticket.channelId));

  if (ticketChannel) {
    await ticketChannel.permissionOverwrites.edit(ticket.userId, {
      ViewChannel: false,
      SendMessages: false
    }).catch(() => null);

    const nextName = ticketChannel.name.startsWith("geschlossen-")
      ? ticketChannel.name
      : `geschlossen-${ticketChannel.name}`.slice(0, 100);

    await ticketChannel.setName(nextName).catch(() => null);
    await ticketChannel.send({
      content: `Ticket geschlossen von <@${interaction.user.id}>.`
    }).catch(() => null);
  }

  const transcriptCreated = await postTicketTranscript({
    interaction,
    ticket: closedTicket,
    config,
    departmentName: department?.name || ""
  });

  const managementChannel = await resolveTextChannel(interaction.guild, config.managementChannelId);
  if (managementChannel) {
    await managementChannel.send({
      content: transcriptCreated
        ? `Ticket ${ticket.id} wurde geschlossen von <@${interaction.user.id}>. Transkript wurde erstellt.`
        : `Ticket ${ticket.id} wurde geschlossen von <@${interaction.user.id}>. Transkript konnte nicht erstellt werden.`
    }).catch(() => null);
  }
}

function updateSupportDepartments(moduleConfigStore, guildId, currentConfig, departments, defaultDepartmentId) {
  moduleConfigStore.setModuleConfig(guildId, "support", {
    ...currentConfig,
    departments,
    defaultDepartmentId
  });
}

async function handleDepartmentUiInteraction({ client, interaction }) {
  if (!interaction.inGuild()) {
    return false;
  }

  const isDepartmentButton = interaction.isButton() && (
    interaction.customId === SUPPORT_DEPT_UI_ADD_BUTTON_ID
    || interaction.customId === SUPPORT_DEPT_UI_REFRESH_BUTTON_ID
    || interaction.customId.startsWith(SUPPORT_DEPT_UI_SET_DEFAULT_PREFIX)
    || interaction.customId.startsWith(SUPPORT_DEPT_UI_SET_ROLES_PREFIX)
    || interaction.customId.startsWith(SUPPORT_DEPT_UI_REMOVE_PREFIX)
  );

  const isDepartmentSelect = interaction.isStringSelectMenu() && interaction.customId === SUPPORT_DEPT_UI_SELECT_ID;
  const isDepartmentModal = interaction.isModalSubmit() && (
    interaction.customId === SUPPORT_DEPT_UI_ADD_MODAL_ID
    || interaction.customId.startsWith(SUPPORT_DEPT_UI_ROLES_MODAL_PREFIX)
  );

  if (!isDepartmentButton && !isDepartmentSelect && !isDepartmentModal) {
    return false;
  }

  if (!canManageServer(interaction.member)) {
    await interaction.reply({
      content: "Nur Admins oder Mitglieder mit Server-verwalten dürfen Departments verwalten.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const { moduleConfigStore, env } = client.botContext;
  const supportState = moduleConfigStore.getModuleState(interaction.guildId, "support");
  const currentConfig = supportState?.config || {};

  const departments = ensureDefaultDepartment(
    currentConfig.departments,
    env.supportDefaultDepartmentName,
    []
  );

  const defaultDepartmentId = ensureValidDefaultDepartmentId(departments, currentConfig.defaultDepartmentId);

  if (interaction.isButton() && interaction.customId === SUPPORT_DEPT_UI_REFRESH_BUTTON_ID) {
    await interaction.update(buildSupportDepartmentManagementPayload(departments, defaultDepartmentId));
    return true;
  }

  if (interaction.isButton() && interaction.customId === SUPPORT_DEPT_UI_ADD_BUTTON_ID) {
    await interaction.showModal(buildSupportDepartmentAddModal());
    return true;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === SUPPORT_DEPT_UI_SELECT_ID) {
    const selectedDepartmentId = interaction.values?.[0] || "";
    const selectedDepartment = getDepartmentById(departments, selectedDepartmentId);
    if (!selectedDepartment) {
      await interaction.reply({
        content: "Department nicht gefunden.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    await interaction.reply({
      ...buildSupportDepartmentActionsPayload(
        selectedDepartment,
        selectedDepartment.id === defaultDepartmentId,
        departments.length > 1
      ),
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(SUPPORT_DEPT_UI_SET_DEFAULT_PREFIX)) {
    const departmentId = interaction.customId.slice(SUPPORT_DEPT_UI_SET_DEFAULT_PREFIX.length);
    const selectedDepartment = getDepartmentById(departments, departmentId);
    if (!selectedDepartment) {
      await interaction.reply({
        content: "Department nicht gefunden.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    updateSupportDepartments(moduleConfigStore, interaction.guildId, currentConfig, departments, departmentId);
    await interaction.update(buildSupportDepartmentActionsPayload(selectedDepartment, true, departments.length > 1));
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(SUPPORT_DEPT_UI_SET_ROLES_PREFIX)) {
    const departmentId = interaction.customId.slice(SUPPORT_DEPT_UI_SET_ROLES_PREFIX.length);
    const selectedDepartment = getDepartmentById(departments, departmentId);
    if (!selectedDepartment) {
      await interaction.reply({
        content: "Department nicht gefunden.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    await interaction.showModal(buildSupportDepartmentRolesModal(selectedDepartment));
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(SUPPORT_DEPT_UI_REMOVE_PREFIX)) {
    const departmentId = interaction.customId.slice(SUPPORT_DEPT_UI_REMOVE_PREFIX.length);
    if (departments.length <= 1) {
      await interaction.reply({
        content: "Es muss mindestens ein Department bestehen bleiben.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const updatedDepartments = departments.filter((department) => department.id !== departmentId);
    if (updatedDepartments.length === departments.length) {
      await interaction.reply({
        content: "Department nicht gefunden.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const nextDefaultDepartmentId = ensureValidDefaultDepartmentId(updatedDepartments, defaultDepartmentId);
    updateSupportDepartments(
      moduleConfigStore,
      interaction.guildId,
      currentConfig,
      updatedDepartments,
      nextDefaultDepartmentId
    );

    await interaction.update({
      content: `Department ${departmentId} wurde entfernt.`,
      embeds: [],
      components: []
    });
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId === SUPPORT_DEPT_UI_ADD_MODAL_ID) {
    const departmentName = interaction.fields.getTextInputValue(SUPPORT_DEPT_UI_ADD_NAME_INPUT_ID)?.trim() || "";
    const rolesRaw = interaction.fields.getTextInputValue(SUPPORT_DEPT_UI_ADD_ROLES_INPUT_ID) || "";

    if (!departmentName) {
      await interaction.reply({
        content: "Department-Name darf nicht leer sein.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const departmentId = createUniqueDepartmentId(departments, departmentName);
    const roleIds = extractRoleIds(rolesRaw);
    const updatedDepartments = [
      ...departments,
      {
        id: departmentId,
        name: departmentName,
        roleIds
      }
    ];

    const nextDefaultDepartmentId = ensureValidDefaultDepartmentId(updatedDepartments, defaultDepartmentId || departmentId);
    updateSupportDepartments(
      moduleConfigStore,
      interaction.guildId,
      currentConfig,
      updatedDepartments,
      nextDefaultDepartmentId
    );

    await interaction.reply({
      content: `Department erstellt: ${departmentName} (${departmentId})`,
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith(SUPPORT_DEPT_UI_ROLES_MODAL_PREFIX)) {
    const departmentId = interaction.customId.slice(SUPPORT_DEPT_UI_ROLES_MODAL_PREFIX.length);
    const selectedDepartment = getDepartmentById(departments, departmentId);
    if (!selectedDepartment) {
      await interaction.reply({
        content: "Department nicht gefunden.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const rolesRaw = interaction.fields.getTextInputValue(SUPPORT_DEPT_UI_ROLES_INPUT_ID) || "";
    const roleIds = extractRoleIds(rolesRaw);

    const updatedDepartments = departments.map((department) => {
      if (department.id !== departmentId) {
        return department;
      }

      return {
        ...department,
        roleIds
      };
    });

    updateSupportDepartments(moduleConfigStore, interaction.guildId, currentConfig, updatedDepartments, defaultDepartmentId);

    await interaction.reply({
      content: `Rollen für ${selectedDepartment.name} wurden aktualisiert.`,
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  return false;
}

async function handleSupportInteraction({ client, interaction }) {
  if (!interaction.inGuild()) {
    return;
  }

  const handledByDepartmentUi = await handleDepartmentUiInteraction({ client, interaction });
  if (handledByDepartmentUi) {
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith(SUPPORT_TICKET_OPEN_MODAL_PREFIX)) {
    await handleTicketOpenModalInteraction({ client, interaction });
    return;
  }

  if (interaction.isButton()) {
    if (interaction.customId === SUPPORT_TICKET_OPEN_BUTTON_ID) {
      await handleTicketOpenButtonInteraction({ client, interaction });
      return;
    }

    if (interaction.customId.startsWith(SUPPORT_TICKET_ESCALATE_PREFIX)) {
      const ticketId = interaction.customId.slice(SUPPORT_TICKET_ESCALATE_PREFIX.length);
      await handleTicketEscalateInteraction({ client, interaction, ticketId });
      return;
    }

    if (interaction.customId.startsWith(SUPPORT_TICKET_CLOSE_PREFIX)) {
      const ticketId = interaction.customId.slice(SUPPORT_TICKET_CLOSE_PREFIX.length);
      await handleTicketCloseInteraction({ client, interaction, ticketId });
      return;
    }

    if (interaction.customId.startsWith(SUPPORT_CLAIM_PREFIX)) {
      const caseId = interaction.customId.slice(SUPPORT_CLAIM_PREFIX.length);
      await handleClaimInteraction({ client, interaction, caseId });
      return;
    }

    if (interaction.customId.startsWith(SUPPORT_ESCALATE_PREFIX)) {
      const caseId = interaction.customId.slice(SUPPORT_ESCALATE_PREFIX.length);
      await handleEscalateInteraction({ client, interaction, caseId });
      return;
    }

    if (interaction.customId.startsWith(SUPPORT_CLOSE_PREFIX)) {
      const caseId = interaction.customId.slice(SUPPORT_CLOSE_PREFIX.length);
      await handleCloseInteraction({ client, interaction, caseId });
      return;
    }

    if (interaction.customId.startsWith(SUPPORT_TRANSCRIPT_PREFIX)) {
      const caseId = interaction.customId.slice(SUPPORT_TRANSCRIPT_PREFIX.length);
      await handleTranscriptInteraction({ client, interaction, caseId });
    }

    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === SUPPORT_TICKET_DEPARTMENT_SELECT_ID) {
    await handleTicketDepartmentSelectInteraction({ client, interaction });
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith(SUPPORT_TICKET_ESCALATE_SELECT_PREFIX)) {
    const ticketId = interaction.customId.slice(SUPPORT_TICKET_ESCALATE_SELECT_PREFIX.length);
    await handleTicketEscalationSelectInteraction({ client, interaction, ticketId });
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith(SUPPORT_ESCALATE_SELECT_PREFIX)) {
    const caseId = interaction.customId.slice(SUPPORT_ESCALATE_SELECT_PREFIX.length);
    await handleEscalationSelectInteraction({ client, interaction, caseId });
  }
}

async function handleSupportGuildCreate({ client, guild }) {
  if (!client.botContext.moduleConfigStore.isModuleEnabled(guild.id, "support")) {
    return;
  }

  await ensureSupportDefaults(client, guild);
}

async function handleSupportReady({ client }) {
  for (const guild of client.guilds.cache.values()) {
    if (!client.botContext.moduleConfigStore.isModuleEnabled(guild.id, "support")) {
      continue;
    }

    await ensureSupportDefaults(client, guild);
  }
}

async function handleSupportVoiceStateUpdate({ client, oldState, newState }) {
  if (!newState?.guild || !newState.member) {
    return;
  }

  if (newState.member.user.bot) {
    return;
  }

  await handleVoiceDisconnectWaitingRoom({ client, oldState, newState });
  await handleVoiceJoinWaitingRoom({ client, oldState, newState });
}

export const supportModule = {
  name: "support",
  defaultEnabled: false,
  defaultConfig: {
    waitingChannelId: "",
    managementChannelId: "",
    talkCategoryId: "",
    ticketCategoryId: "",
    talkChannelIds: [],
    transcriptTextChannelId: "",
    defaultDepartmentId: "default",
    departments: []
  },
  commands: [
    supportDepartmentCommand,
    supportDepartmentUiCommand,
    supportTicketPanelCommand
  ],
  events: {
    interactionCreate: [handleSupportInteraction],
    guildCreate: [handleSupportGuildCreate],
    ready: [handleSupportReady],
    voiceStateUpdate: [handleSupportVoiceStateUpdate]
  }
};
