import { ChannelType, PermissionFlagsBits } from "discord.js";
import { DEFAULT_VERIFY_RULES_TEXT, upsertVerifyPanel } from "./panel.js";

async function resolveRole(guild, roleId) {
  if (!roleId) {
    return null;
  }

  return guild.roles.cache.get(roleId)
    || (await guild.roles.fetch(roleId).catch(() => null));
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

async function createDefaultRole(guild, roleName, logger) {
  try {
    return await guild.roles.create({
      name: roleName,
      reason: "Standardrolle für Verify-Modul"
    });
  } catch (error) {
    logger.warn("Standard-Verify-Rolle konnte nicht erstellt werden", {
      guildId: guild.id,
      error: String(error)
    });
    return null;
  }
}

async function createDefaultChannel(guild, channelName, logger) {
  try {
    return await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      topic: "Konfiguration und Bedienung des Verify-Moduls"
    });
  } catch (error) {
    logger.warn("Standard-Verify-Channel konnte nicht erstellt werden", {
      guildId: guild.id,
      error: String(error)
    });
    return null;
  }
}

export async function ensureVerifyDefaults(client, guild) {
  const { moduleConfigStore, env, logger } = client.botContext;
  const verifyState = moduleConfigStore.getModuleState(guild.id, "verify");

  if (!verifyState || !verifyState.enabled) {
    return verifyState;
  }

  const currentConfig = verifyState.config || {};
  const updates = {};

  let role = await resolveRole(guild, currentConfig.roleId);
  if (!role) {
    role = await createDefaultRole(guild, env.verifyDefaultRoleName, logger);
    if (role) {
      updates.roleId = role.id;
    }
  }

  let channel = await resolveTextChannel(guild, currentConfig.channelId);
  if (!channel) {
    channel = await createDefaultChannel(guild, env.verifyDefaultChannelName, logger);
    if (channel) {
      updates.channelId = channel.id;
    }
  }

  const nextConfig = {
    rulesText: currentConfig.rulesText || DEFAULT_VERIFY_RULES_TEXT,
    ...currentConfig,
    ...updates
  };

  if (channel) {
    const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
    const perms = me ? channel.permissionsFor(me) : null;
    const canSend = perms
      && perms.has(PermissionFlagsBits.ViewChannel)
      && perms.has(PermissionFlagsBits.SendMessages);

    if (canSend) {
      const message = await upsertVerifyPanel(
        channel,
        nextConfig.panelMessageId || "",
        nextConfig.rulesText || DEFAULT_VERIFY_RULES_TEXT
      );
      if (message) {
        nextConfig.panelMessageId = message.id;
      }
    }
  }

  moduleConfigStore.setModuleConfig(guild.id, "verify", nextConfig);
  return moduleConfigStore.getModuleState(guild.id, "verify");
}
