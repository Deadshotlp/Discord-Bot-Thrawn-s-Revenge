import { ChannelType } from "discord.js";
import { ensureDefaultDepartment, ensureValidDefaultDepartmentId } from "./config.js";

export async function resolveGuildMember(guild, userId) {
  return guild.members.cache.get(userId)
    || (await guild.members.fetch(userId).catch(() => null));
}

export async function resolveVoiceChannel(guild, channelId) {
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

export async function resolveTextChannel(guild, channelId) {
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

export async function resolveTranscriptChannel(guild, config) {
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

export async function resolveExistingRoleIds(guild, roleIds) {
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

export function getSupportConfig(moduleConfigStore, guildId, env) {
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
