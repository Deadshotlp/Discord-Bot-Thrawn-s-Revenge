import { EmbedBuilder } from "discord.js";
import { resolveTextAnnouncementChannel } from "../../core/discordUtil.js";
import { steamCommand } from "./commands/steam.js";
import { STEAM_LINK_DEFAULT_CONFIG, normalizeSteamLinkConfig } from "./services/config.js";
import { syncLinkedRole } from "./services/roles.js";
import { describeSteamId } from "./services/steamId.js";

/**
 * Wird vom Ingest-Endpunkt aufgerufen, sobald ein Spieler im Spiel
 * seinen Code eingelöst hat.
 */
export async function onSteamLinked(client, link) {
  await syncLinkedRole(client, link.guildId, link.discordId, true).catch(() => null);

  const config = normalizeSteamLinkConfig(
    client.botContext.settingsStore.getModuleState(link.guildId, "steam-link")?.config
  );

  const user = await client.users.fetch(link.discordId).catch(() => null);
  const described = describeSteamId(link.steamId);

  if (user) {
    await user.send({
      embeds: [new EmbedBuilder()
        .setTitle("✅ Steam verknüpft")
        .setColor(0x57f287)
        .setDescription(`Dein Account ist jetzt mit \`${described.steamId64}\` verbunden. Deine Spielzeit wird ab sofort erfasst.`)]
    }).catch(() => null);
  }

  if (!config.announceChannelId) {
    return;
  }

  const guild = client.guilds.cache.get(link.guildId);
  const channel = guild ? await resolveTextAnnouncementChannel(guild, config.announceChannelId) : null;

  await channel?.send({
    content: `🔗 <@${link.discordId}> hat Steam verknüpft (\`${described.classic}\`).`
  }).catch(() => null);
}

export const steamLinkModule = {
  name: "steam-link",
  label: "Steam-Verknüpfung",
  description: "Verbindet Discord-Accounts mit SteamIDs und erfasst darüber die Spielzeit auf den Servern.",
  defaultEnabled: false,
  defaultConfig: { ...STEAM_LINK_DEFAULT_CONFIG },
  commands: [steamCommand],
  events: {}
};
