import { normalizeSteamLinkConfig } from "./config.js";

// Optionale Rolle für verknüpfte Mitglieder – praktisch für In-Game-Vorteile
// oder um zu sehen, wer die Verknüpfung noch offen hat.
export async function syncLinkedRole(client, guildId, userId, linked) {
  const config = normalizeSteamLinkConfig(
    client.botContext.settingsStore.getModuleState(guildId, "steam-link")?.config
  );

  if (!config.linkedRoleId) {
    return false;
  }

  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    return false;
  }

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) {
    return false;
  }

  if (linked) {
    if (!member.roles.cache.has(config.linkedRoleId)) {
      await member.roles.add(config.linkedRoleId).catch(() => null);
    }

    return true;
  }

  if (member.roles.cache.has(config.linkedRoleId)) {
    await member.roles.remove(config.linkedRoleId).catch(() => null);
  }

  return true;
}
