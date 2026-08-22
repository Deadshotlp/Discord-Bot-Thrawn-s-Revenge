import { runEventHandlers } from "../core/moduleRuntime.js";

/**
 * Mitglieder-Ereignisse kommen nur an, wenn das privilegierte Intent
 * GuildMembers aktiv ist (GUILD_MEMBERS_INTENT=true). Ohne das Intent
 * registriert der Bot diese Ereignisse gar nicht erst.
 */
export async function handleGuildMemberUpdate(client, oldMember, newMember) {
  const { logger, modules } = client.botContext;

  await runEventHandlers(
    modules,
    "guildMemberUpdate",
    { client, guild: newMember.guild || oldMember.guild, oldMember, newMember },
    logger
  );
}

export async function handleGuildMemberAdd(client, member) {
  const { logger, modules } = client.botContext;

  await runEventHandlers(modules, "guildMemberAdd", { client, guild: member.guild, member }, logger);
}

export async function handleGuildMemberRemove(client, member) {
  const { logger, modules } = client.botContext;

  await runEventHandlers(modules, "guildMemberRemove", { client, guild: member.guild, member }, logger);
}
