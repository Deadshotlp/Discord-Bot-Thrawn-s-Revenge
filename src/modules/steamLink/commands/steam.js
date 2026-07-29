import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import { canManageServer } from "../../../core/permissions.js";
import { recordAudit } from "../../../core/audit.js";
import { getPlaytimeForSteamId, getRecentSessions } from "../../monitoring/services/playtime.js";
import { getServer, listServers } from "../../monitoring/services/servers.js";
import { describeSteamId, parseSteamId } from "../services/steamId.js";
import {
  createLinkCode,
  getLinkByDiscordId,
  getLinkBySteamId,
  removeLink,
  setLink
} from "../services/store.js";
import { normalizeSteamLinkConfig } from "../services/config.js";
import { syncLinkedRole } from "../services/roles.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function formatDuration(seconds) {
  if (!seconds) {
    return "0 min";
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days} d ${hours % 24} h`;
  }

  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

const RANGE_CHOICES = [
  { name: "7 Tage", value: "7" },
  { name: "30 Tage", value: "30" },
  { name: "90 Tage", value: "90" },
  { name: "Gesamt", value: "0" }
];

export const steamCommand = {
  data: new SlashCommandBuilder()
    .setName("steam")
    .setDescription("Steam-Account mit Discord verknüpfen und Spielzeit einsehen")
    .setDMPermission(false)
    .addSubcommand((subcommand) => subcommand
      .setName("verknuepfen")
      .setDescription("Verknüpfungscode für den Spielserver anfordern"))
    .addSubcommand((subcommand) => subcommand
      .setName("status")
      .setDescription("Zeigt die hinterlegte SteamID")
      .addUserOption((option) => option
        .setName("mitglied")
        .setDescription("Anderes Mitglied (nur Team)")))
    .addSubcommand((subcommand) => subcommand
      .setName("entfernen")
      .setDescription("Verknüpfung aufheben")
      .addUserOption((option) => option
        .setName("mitglied")
        .setDescription("Anderes Mitglied (nur Team)")))
    .addSubcommand((subcommand) => subcommand
      .setName("setzen")
      .setDescription("SteamID manuell zuordnen (Team)")
      .addUserOption((option) => option
        .setName("mitglied")
        .setDescription("Discord-Mitglied")
        .setRequired(true))
      .addStringOption((option) => option
        .setName("steamid")
        .setDescription("SteamID64, STEAM_0:X:Y, [U:1:Z] oder Profil-Link")
        .setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("spielzeit")
      .setDescription("Spielzeit auf den überwachten Servern")
      .addUserOption((option) => option
        .setName("mitglied")
        .setDescription("Anderes Mitglied"))
      .addStringOption((option) => option
        .setName("zeitraum")
        .setDescription("Zeitraum")
        .addChoices(...RANGE_CHOICES)))
    .addSubcommand((subcommand) => subcommand
      .setName("wer")
      .setDescription("Welchem Discord-Account gehört eine SteamID? (Team)")
      .addStringOption((option) => option
        .setName("steamid")
        .setDescription("SteamID in beliebigem Format")
        .setRequired(true))),

  async execute({ client, interaction }) {
    const { settingsStore } = client.botContext;
    const config = normalizeSteamLinkConfig(
      settingsStore.getModuleState(interaction.guildId, "steam-link")?.config
    );
    const subcommand = interaction.options.getSubcommand();
    const isStaff = canManageServer(interaction.member);

    if (subcommand === "verknuepfen") {
      const existing = getLinkByDiscordId(interaction.guildId, interaction.user.id);
      const { code, expiresAt } = createLinkCode(interaction.guildId, interaction.user.id);

      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle("🔗 Steam verknüpfen")
          .setColor(0x5865f2)
          .setDescription([
            existing
              ? `Aktuell verknüpft: \`${existing.steamId}\`. Ein neuer Code überschreibt diese Zuordnung.`
              : "So verbindest du deinen Steam-Account mit Discord:",
            "",
            "**1.** Verbinde dich mit dem Spielserver.",
            `**2.** Gib im Chat ein: \`${config.ingameCommand} ${code}\``,
            "**3.** Fertig – der Bot bestätigt die Verknüpfung.",
            "",
            `Der Code läuft <t:${Math.floor(expiresAt / 1000)}:R> ab.`,
            config.dashboardHint
              ? "Alternativ kannst du dich im Dashboard direkt über Steam anmelden."
              : ""
          ].filter(Boolean).join("\n"))],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === "status") {
      const target = interaction.options.getUser("mitglied");
      if (target && target.id !== interaction.user.id && !isStaff) {
        await interaction.reply({
          content: "Du darfst nur deine eigene Verknüpfung einsehen.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const userId = target?.id || interaction.user.id;
      const link = getLinkByDiscordId(interaction.guildId, userId);

      if (!link) {
        await interaction.reply({
          content: userId === interaction.user.id
            ? "Du hast noch keinen Steam-Account verknüpft. Nutze `/steam verknuepfen`."
            : "Für dieses Mitglied ist keine SteamID hinterlegt.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const described = describeSteamId(link.steamId);
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle("Steam-Verknüpfung")
          .setColor(0x57f287)
          .setDescription(`<@${userId}>`)
          .addFields(
            { name: "SteamID64", value: `\`${described.steamId64}\``, inline: false },
            { name: "Klassisch", value: `\`${described.classic}\``, inline: true },
            { name: "Steam3", value: `\`${described.steam3}\``, inline: true },
            { name: "Profil", value: described.profileUrl, inline: false },
            { name: "Verknüpft am", value: `<t:${Math.floor(link.verifiedAt / 1000)}:D>`, inline: true },
            { name: "Quelle", value: link.source, inline: true }
          )],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === "entfernen") {
      const target = interaction.options.getUser("mitglied");
      if (target && target.id !== interaction.user.id && !isStaff) {
        await interaction.reply({
          content: "Nur das Team darf fremde Verknüpfungen entfernen.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const userId = target?.id || interaction.user.id;
      const removed = removeLink(interaction.guildId, userId);

      if (removed) {
        recordAudit({
          guildId: interaction.guildId,
          actorId: interaction.user.id,
          actorName: interaction.user.username,
          action: "steam.unlink",
          detail: { userId }
        });

        await syncLinkedRole(client, interaction.guildId, userId, false).catch(() => null);
      }

      await interaction.reply({
        content: removed ? "Verknüpfung entfernt." : "Es war keine Verknüpfung hinterlegt.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === "setzen") {
      if (!isStaff) {
        await interaction.reply({
          content: "Dafür brauchst du die Berechtigung „Server verwalten“.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const target = interaction.options.getUser("mitglied", true);
      const rawSteamId = interaction.options.getString("steamid", true);

      try {
        const link = setLink({
          guildId: interaction.guildId,
          discordId: target.id,
          steamId: rawSteamId,
          source: "manual"
        });

        recordAudit({
          guildId: interaction.guildId,
          actorId: interaction.user.id,
          actorName: interaction.user.username,
          action: "steam.link.manual",
          detail: { userId: target.id, steamId: link.steamId }
        });

        await syncLinkedRole(client, interaction.guildId, target.id, true).catch(() => null);

        await interaction.reply({
          content: `<@${target.id}> ist jetzt mit \`${link.steamId}\` verknüpft.`,
          flags: MessageFlags.Ephemeral
        });
      } catch (error) {
        await interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral });
      }

      return;
    }

    if (subcommand === "spielzeit") {
      const target = interaction.options.getUser("mitglied") || interaction.user;
      const link = getLinkByDiscordId(interaction.guildId, target.id);

      if (!link) {
        await interaction.reply({
          content: target.id === interaction.user.id
            ? "Verknüpfe zuerst deinen Steam-Account mit `/steam verknuepfen`."
            : "Für dieses Mitglied ist keine SteamID hinterlegt.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const days = Number(interaction.options.getString("zeitraum") || "30");
      const stats = getPlaytimeForSteamId(link.steamId, days > 0 ? days * DAY_MS : 0);
      const servers = new Map(listServers(interaction.guildId).map((server) => [server.id, server]));

      const perServerLines = stats.perServer
        .filter((entry) => servers.has(entry.serverId))
        .sort((a, b) => b.seconds - a.seconds)
        .map((entry) => `**${servers.get(entry.serverId).name}** — ${formatDuration(entry.seconds)} (${entry.sessions} Sitzungen)`);

      const recent = getRecentSessions(link.steamId, 5)
        .filter((session) => servers.has(session.serverId))
        .map((session) => `<t:${Math.floor(session.startedAt / 1000)}:d> · ${formatDuration(session.seconds)} · ${servers.get(session.serverId).name}`);

      const embed = new EmbedBuilder()
        .setTitle(`Spielzeit · ${target.displayName || target.username}`)
        .setColor(0x5865f2)
        .setDescription(days > 0 ? `Zeitraum: letzte ${days} Tage` : "Zeitraum: gesamt")
        .addFields(
          { name: "Gesamt", value: formatDuration(stats.seconds), inline: true },
          { name: "Sitzungen", value: String(stats.sessions), inline: true },
          {
            name: "Zuletzt gesehen",
            value: stats.lastSeen ? `<t:${Math.floor(stats.lastSeen / 1000)}:R>` : "–",
            inline: true
          }
        );

      if (perServerLines.length > 0) {
        embed.addFields({ name: "Pro Server", value: perServerLines.join("\n").slice(0, 1024) });
      }

      if (recent.length > 0) {
        embed.addFields({ name: "Letzte Sitzungen", value: recent.join("\n").slice(0, 1024) });
      }

      if (stats.sessions === 0) {
        embed.setFooter({ text: "Noch keine Spielzeit erfasst – läuft das Ingest-Addon auf dem Server?" });
      }

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (subcommand === "wer") {
      if (!isStaff) {
        await interaction.reply({
          content: "Diese Abfrage ist dem Team vorbehalten.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const steamId = parseSteamId(interaction.options.getString("steamid", true));
      if (!steamId) {
        await interaction.reply({ content: "SteamID konnte nicht gelesen werden.", flags: MessageFlags.Ephemeral });
        return;
      }

      const link = getLinkBySteamId(interaction.guildId, steamId);
      if (!link) {
        await interaction.reply({
          content: `Zu \`${steamId}\` ist kein Discord-Account verknüpft.`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const stats = getPlaytimeForSteamId(steamId, 30 * DAY_MS);
      const lastServer = stats.perServer.sort((a, b) => b.lastSeen - a.lastSeen)[0];
      const serverName = lastServer ? getServer(lastServer.serverId)?.name : null;

      await interaction.reply({
        content: [
          `\`${steamId}\` gehört zu <@${link.discordId}>.`,
          `Spielzeit (30 Tage): ${formatDuration(stats.seconds)}`,
          serverName ? `Zuletzt auf: ${serverName}` : ""
        ].filter(Boolean).join("\n"),
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
