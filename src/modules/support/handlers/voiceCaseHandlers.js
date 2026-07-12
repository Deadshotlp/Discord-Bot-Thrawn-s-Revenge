import { getDepartmentById } from "../services/config.js";
import {
  getSupportConfig,
  resolveExistingRoleIds,
  resolveTextChannel,
  resolveVoiceChannel
} from "../services/channelResolvers.js";
import {
  addSupportCaseAction,
  closeSupportCase,
  createSupportCase,
  getUserActiveCase,
  setCaseManagementMessage
} from "../services/cases.js";
import {
  buildSupportClaimedMessage,
  buildSupportClosedMessage,
  buildSupportOpenCaseMessage
} from "../services/panel.js";

export async function updateCaseMessage(guild, caseData, config) {
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

export async function handleVoiceJoinWaitingRoom({ client, newState, oldState }) {
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

export async function handleVoiceDisconnectWaitingRoom({ client, oldState, newState }) {
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

export async function handleSupportVoiceStateUpdate({ client, oldState, newState }) {
  if (!newState?.guild || !newState.member) {
    return;
  }

  if (newState.member.user.bot) {
    return;
  }

  await handleVoiceDisconnectWaitingRoom({ client, oldState, newState });
  await handleVoiceJoinWaitingRoom({ client, oldState, newState });
}
