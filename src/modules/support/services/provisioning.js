import { ChannelType, PermissionFlagsBits } from "discord.js";
import {
  ensureDefaultDepartment,
  ensureValidDefaultDepartmentId,
  extractRoleIds,
  SUPPORT_DEFAULT_DEPARTMENT_ID
} from "./config.js";

async function resolveChannel(guild, channelId, expectedType) {
  if (!channelId) {
    return null;
  }

  const channel = guild.channels.cache.get(channelId)
    || (await guild.channels.fetch(channelId).catch(() => null));

  if (!channel || channel.type !== expectedType) {
    return null;
  }

  return channel;
}

async function createChannel(guild, options, logger, contextLabel) {
  try {
    return await guild.channels.create(options);
  } catch (error) {
    logger.warn(`${contextLabel} konnte nicht erstellt werden`, {
      guildId: guild.id,
      error: String(error)
    });
    return null;
  }
}

function normalizeTalkChannelCount(rawCount) {
  const parsed = Number(rawCount);
  if (!Number.isInteger(parsed)) {
    return 3;
  }

  return Math.max(1, Math.min(parsed, 10));
}

function normalizeTalkChannelPrefix(prefix) {
  const text = String(prefix || "support-talk").trim();
  return text || "support-talk";
}

export async function ensureSupportDefaults(client, guild) {
  const { moduleConfigStore, env, logger } = client.botContext;
  const supportState = moduleConfigStore.getModuleState(guild.id, "support");

  if (!supportState || !supportState.enabled) {
    return supportState;
  }

  const currentConfig = supportState.config || {};
  const updates = {};

  let waitingChannel = await resolveChannel(guild, currentConfig.waitingChannelId, ChannelType.GuildVoice);
  if (!waitingChannel) {
    waitingChannel = await createChannel(
      guild,
      {
        name: env.supportWaitingChannelName,
        type: ChannelType.GuildVoice,
        reason: "Standard-Warteraum für Support-Modul"
      },
      logger,
      "Support-Warteraum"
    );

    if (waitingChannel) {
      updates.waitingChannelId = waitingChannel.id;
    }
  }

  let managementChannel = await resolveChannel(guild, currentConfig.managementChannelId, ChannelType.GuildText);
  if (!managementChannel) {
    managementChannel = await createChannel(
      guild,
      {
        name: env.supportManagementChannelName,
        type: ChannelType.GuildText,
        topic: "Support-Fälle, Claims, Eskalation und Transkripte",
        reason: "Standard-Verwaltungskanal für Support-Modul"
      },
      logger,
      "Support-Verwaltungskanal"
    );

    if (managementChannel) {
      updates.managementChannelId = managementChannel.id;
    }
  }

  let talkCategory = await resolveChannel(guild, currentConfig.talkCategoryId, ChannelType.GuildCategory);
  if (!talkCategory) {
    talkCategory = await createChannel(
      guild,
      {
        name: env.supportTalkCategoryName,
        type: ChannelType.GuildCategory,
        reason: "Kategorie für Support-Talk-Channels"
      },
      logger,
      "Support-Talk-Kategorie"
    );

    if (talkCategory) {
      updates.talkCategoryId = talkCategory.id;
    }
  }

  let ticketCategory = await resolveChannel(guild, currentConfig.ticketCategoryId, ChannelType.GuildCategory);
  if (!ticketCategory) {
    ticketCategory = await createChannel(
      guild,
      {
        name: env.supportTicketCategoryName,
        type: ChannelType.GuildCategory,
        reason: "Kategorie für Support-Tickets"
      },
      logger,
      "Support-Ticket-Kategorie"
    );

    if (ticketCategory) {
      updates.ticketCategoryId = ticketCategory.id;
    }
  }

  const knownTalkIds = Array.isArray(currentConfig.talkChannelIds)
    ? currentConfig.talkChannelIds
    : [];

  const validTalkChannels = [];
  for (const channelId of knownTalkIds) {
    const channel = await resolveChannel(guild, channelId, ChannelType.GuildVoice);
    if (!channel) {
      continue;
    }

    validTalkChannels.push(channel);
  }

  const talkTargetCount = normalizeTalkChannelCount(env.supportTalkChannelCount);
  const talkPrefix = normalizeTalkChannelPrefix(env.supportTalkChannelPrefix);

  while (validTalkChannels.length < talkTargetCount) {
    const createdChannel = await createChannel(
      guild,
      {
        name: `${talkPrefix}-${validTalkChannels.length + 1}`,
        type: ChannelType.GuildVoice,
        parent: talkCategory?.id || null,
        reason: "Automatisch erstellter Support-Talk"
      },
      logger,
      "Support-Talk-Channel"
    );

    if (!createdChannel) {
      break;
    }

    validTalkChannels.push(createdChannel);
  }

  if (validTalkChannels.length > 0) {
    updates.talkChannelIds = validTalkChannels.map((channel) => channel.id);
  }

  const defaultRoleIds = extractRoleIds(env.supportDefaultDepartmentRoleIdsRaw || "");
  const departments = ensureDefaultDepartment(
    currentConfig.departments,
    env.supportDefaultDepartmentName,
    defaultRoleIds
  );

  const defaultDepartmentId = ensureValidDefaultDepartmentId(
    departments,
    currentConfig.defaultDepartmentId || SUPPORT_DEFAULT_DEPARTMENT_ID
  );

  const nextConfig = {
    ...currentConfig,
    ...updates,
    departments,
    defaultDepartmentId,
    transcriptTextChannelId: currentConfig.transcriptTextChannelId || updates.managementChannelId || currentConfig.managementChannelId || ""
  };

  moduleConfigStore.setModuleConfig(guild.id, "support", nextConfig);

  if (managementChannel) {
    const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
    const permissions = me ? managementChannel.permissionsFor(me) : null;

    if (!permissions || !permissions.has(PermissionFlagsBits.SendMessages)) {
      logger.warn("Support-Verwaltungskanal ist vorhanden, aber Bot kann keine Nachrichten senden", {
        guildId: guild.id,
        channelId: managementChannel.id
      });
    }
  }

  return moduleConfigStore.getModuleState(guild.id, "support");
}
