import {
  AttachmentBuilder,
  ChannelType,
  MessageFlags
} from "discord.js";
import { canManageServer } from "../../core/permissions.js";
import { supportDepartmentCommand } from "./commands/supportDepartment.js";
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
  ensureDefaultDepartment,
  ensureValidDefaultDepartmentId,
  getDepartmentById,
  hasDepartmentAccess
} from "./services/config.js";
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
    return;
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

  if (!managementChannel) {
    logger.warn("Support-Fall konnte nicht in Verwaltungskanal gepostet werden", {
      guildId: newState.guild.id,
      caseId: caseData.id
    });
    return;
  }

  const message = await managementChannel.send(buildSupportOpenCaseMessage(caseData, department));
  setCaseManagementMessage(newState.guild.id, caseData.id, message.id);
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

  if (!canHandleCase(interaction, caseData)) {
    await interaction.reply({
      content: "Du darfst diesen Fall nicht eskalieren.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const config = getSupportConfig(client.botContext.moduleConfigStore, interaction.guildId, client.botContext.env);
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

  if (!canHandleCase(interaction, caseData)) {
    await interaction.reply({
      content: "Du darfst diesen Fall nicht eskalieren.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const selectedDepartmentId = interaction.values?.[0] || "";
  const config = getSupportConfig(client.botContext.moduleConfigStore, interaction.guildId, client.botContext.env);
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
    const pingMentions = selectedDepartment.roleIds.length > 0
      ? selectedDepartment.roleIds.map((roleId) => `<@&${roleId}>`).join(" ")
      : "@here";

    await managementChannel.send({
      content: `${pingMentions}\nFall ${caseId} wurde eskaliert von <@${interaction.user.id}> auf ${selectedDepartment.name}.`,
      allowedMentions: {
        parse: [],
        roles: selectedDepartment.roleIds
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

  const talkChannel = await resolveVoiceChannel(interaction.guild, caseData.talkChannelId);
  const me = interaction.guild.members.me || (await interaction.guild.members.fetchMe().catch(() => null));
  let botJoinedTalk = false;

  if (talkChannel && me) {
    await me.voice.setChannel(talkChannel, "Transkript-Anforderung").then(() => {
      botJoinedTalk = true;
    }).catch(() => null);
  }

  const config = getSupportConfig(client.botContext.moduleConfigStore, interaction.guildId, client.botContext.env);
  const department = getDepartmentById(config.departments, caseData.departmentId);
  const transcriptContent = buildCaseTranscript(caseData, department?.name || "");
  const attachment = new AttachmentBuilder(Buffer.from(transcriptContent, "utf8"), {
    name: `support-case-${caseId}.txt`
  });

  const targetChannelId = config.transcriptTextChannelId || config.managementChannelId;
  const targetChannel = await resolveTextChannel(interaction.guild, targetChannelId);

  if (!targetChannel) {
    await interaction.reply({
      content: "Transkript-Channel ist nicht verfügbar.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await targetChannel.send({
    content: `Transkript für Fall ${caseId} (angefordert von <@${interaction.user.id}>)`,
    files: [attachment]
  });

  if (botJoinedTalk && me) {
    await me.voice.setChannel(null, "Transkript abgeschlossen").catch(() => null);
  }

  await interaction.reply({
    content: "Transkript wurde erstellt und im Verwaltungs-Channel gepostet.",
    flags: MessageFlags.Ephemeral
  });
}

async function handleSupportInteraction({ client, interaction }) {
  if (!interaction.inGuild()) {
    return;
  }

  if (interaction.isButton()) {
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

  await handleVoiceJoinWaitingRoom({ client, oldState, newState });
}

export const supportModule = {
  name: "support",
  defaultEnabled: false,
  defaultConfig: {
    waitingChannelId: "",
    managementChannelId: "",
    talkCategoryId: "",
    talkChannelIds: [],
    transcriptTextChannelId: "",
    defaultDepartmentId: "default",
    departments: []
  },
  commands: [supportDepartmentCommand],
  events: {
    interactionCreate: [handleSupportInteraction],
    guildCreate: [handleSupportGuildCreate],
    ready: [handleSupportReady],
    voiceStateUpdate: [handleSupportVoiceStateUpdate]
  }
};
