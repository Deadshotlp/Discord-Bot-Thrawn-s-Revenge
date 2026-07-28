import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { canManageServer } from "../../../core/permissions.js";
import { recordAudit } from "../../../core/audit.js";
import { DAY_MS, getSeries } from "../services/history.js";
import { getTopPlayers } from "../services/playtime.js";
import { buildServerEmbed, resolveRange } from "../services/panel.js";
import { buildMultiServerChartUrl } from "../services/chart.js";
import { listServerKinds, queryServer, SERVER_KINDS } from "../services/protocols/index.js";
import {
  createServer,
  deleteServer,
  getServer,
  listServers,
  updateServer
} from "../services/servers.js";
import { syncPollJobs } from "../services/poller.js";

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

async function respondServerChoices(interaction) {
  const focused = String(interaction.options.getFocused() || "").toLowerCase();
  const servers = listServers(interaction.guildId)
    .filter((server) => !focused || server.name.toLowerCase().includes(focused) || server.host.includes(focused))
    .slice(0, 25);

  await interaction.respond(
    servers.map((server) => ({
      name: `${server.name} (${server.host}:${server.port})`.slice(0, 100),
      value: server.id
    }))
  );
}

export const serverCommand = {
  data: new SlashCommandBuilder()
    .setName("server")
    .setDescription("Überwachte Game-Server verwalten und abfragen")
    .setDMPermission(false)
    .addSubcommand((subcommand) => subcommand
      .setName("add")
      .setDescription("Einen weiteren Server zur Überwachung hinzufügen (sofort aktiv)")
      .addStringOption((option) => option
        .setName("name")
        .setDescription("Anzeigename, z. B. „DarkRP Hauptserver“")
        .setRequired(true)
        .setMaxLength(80))
      .addStringOption((option) => option
        .setName("host")
        .setDescription("IP oder Hostname")
        .setRequired(true))
      .addIntegerOption((option) => option
        .setName("port")
        .setDescription("Spiel-Port")
        .setMinValue(1)
        .setMaxValue(65535))
      .addStringOption((option) => option
        .setName("typ")
        .setDescription("Server-Typ (Standard: Source/GMod)")
        .addChoices(...listServerKinds().map((kind) => ({ name: kind.label, value: kind.id }))))
      .addIntegerOption((option) => option
        .setName("intervall")
        .setDescription("Abtastrate in Sekunden (15–3600, Standard 30)")
        .setMinValue(15)
        .setMaxValue(3600))
      .addIntegerOption((option) => option
        .setName("query-port")
        .setDescription("Abweichender Query-Port")
        .setMinValue(1)
        .setMaxValue(65535))
      .addStringOption((option) => option
        .setName("farbe")
        .setDescription("Hex-Farbe für Diagramme, z. B. #57f287")))
    .addSubcommand((subcommand) => subcommand
      .setName("list")
      .setDescription("Alle überwachten Server anzeigen"))
    .addSubcommand((subcommand) => subcommand
      .setName("remove")
      .setDescription("Einen Server aus der Überwachung entfernen")
      .addStringOption((option) => option
        .setName("server")
        .setDescription("Server")
        .setRequired(true)
        .setAutocomplete(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("edit")
      .setDescription("Einstellungen eines Servers ändern")
      .addStringOption((option) => option
        .setName("server")
        .setDescription("Server")
        .setRequired(true)
        .setAutocomplete(true))
      .addStringOption((option) => option.setName("name").setDescription("Neuer Anzeigename"))
      .addStringOption((option) => option.setName("host").setDescription("Neuer Host"))
      .addIntegerOption((option) => option.setName("port").setDescription("Neuer Port").setMinValue(1).setMaxValue(65535))
      .addIntegerOption((option) => option
        .setName("intervall")
        .setDescription("Neue Abtastrate in Sekunden")
        .setMinValue(15)
        .setMaxValue(3600))
      .addBooleanOption((option) => option.setName("aktiv").setDescription("Überwachung aktiv?"))
      .addStringOption((option) => option.setName("farbe").setDescription("Hex-Farbe")))
    .addSubcommand((subcommand) => subcommand
      .setName("status")
      .setDescription("Aktuellen Status inklusive Verlauf anzeigen")
      .addStringOption((option) => option
        .setName("server")
        .setDescription("Server (leer = alle)")
        .setAutocomplete(true))
      .addStringOption((option) => option
        .setName("zeitraum")
        .setDescription("Zeitraum des Diagramms")
        .addChoices(
          { name: "24 Stunden", value: "24h" },
          { name: "7 Tage", value: "7d" },
          { name: "30 Tage", value: "30d" }
        )))
    .addSubcommand((subcommand) => subcommand
      .setName("vergleich")
      .setDescription("Spielerzahlen aller Server im Vergleich")
      .addStringOption((option) => option
        .setName("zeitraum")
        .setDescription("Zeitraum")
        .addChoices(
          { name: "24 Stunden", value: "24h" },
          { name: "7 Tage", value: "7d" },
          { name: "30 Tage", value: "30d" }
        )))
    .addSubcommand((subcommand) => subcommand
      .setName("top")
      .setDescription("Spieler mit der meisten Spielzeit")
      .addStringOption((option) => option
        .setName("server")
        .setDescription("Server")
        .setRequired(true)
        .setAutocomplete(true))),

  alwaysAvailable: true,

  async autocomplete({ interaction }) {
    await respondServerChoices(interaction);
  },

  async execute({ client, interaction }) {
    const subcommand = interaction.options.getSubcommand();

    if (["add", "remove", "edit"].includes(subcommand) && !canManageServer(interaction.member)) {
      await interaction.reply({
        content: "Dafür brauchst du die Berechtigung „Server verwalten“.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === "add") {
      const kind = interaction.options.getString("typ") || "source";
      const defaultPort = SERVER_KINDS[kind]?.defaultPort || 27015;

      let server;
      try {
        server = createServer(interaction.guildId, {
          name: interaction.options.getString("name"),
          host: interaction.options.getString("host"),
          port: interaction.options.getInteger("port") ?? defaultPort,
          queryPort: interaction.options.getInteger("query-port") ?? undefined,
          kind,
          intervalSeconds: interaction.options.getInteger("intervall") ?? 30,
          color: interaction.options.getString("farbe") || undefined
        }, interaction.user.id);
      } catch (error) {
        await interaction.reply({
          content: `Server konnte nicht angelegt werden: ${error.message}`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      recordAudit({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        actorName: interaction.user.username,
        action: "monitor.server.create",
        detail: { serverId: server.id, name: server.name, host: server.host }
      });

      // Sofort testen und den Poller neu aufsetzen – kein Neustart nötig.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const probe = await queryServer(server);
      syncPollJobs(client);

      await interaction.editReply({
        content: [
          `**${server.name}** wird jetzt überwacht.`,
          `Typ: \`${SERVER_KINDS[server.kind].label}\` · Adresse: \`${server.host}:${server.port}\``,
          `Abtastrate: alle ${server.intervalSeconds} Sekunden`,
          probe.online
            ? `Testabfrage erfolgreich: ${probe.players}/${probe.maxPlayers} Spieler${probe.map ? ` auf \`${probe.map}\`` : ""}.`
            : "Testabfrage fehlgeschlagen – der Server wird trotzdem überwacht und meldet sich, sobald er antwortet."
        ].join("\n")
      });
      return;
    }

    if (subcommand === "list") {
      const servers = listServers(interaction.guildId);
      if (servers.length === 0) {
        await interaction.reply({
          content: "Es werden noch keine Server überwacht. Lege einen mit `/server add` an.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      await interaction.reply({
        content: servers
          .map((server) => [
            `${server.enabled ? "🟢" : "⚪"} **${server.name}**`,
            `   \`${server.host}:${server.port}\` · ${SERVER_KINDS[server.kind]?.label || server.kind} · alle ${server.intervalSeconds}s`
          ].join("\n"))
          .join("\n"),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === "remove") {
      const serverId = interaction.options.getString("server", true);
      const server = getServer(serverId);

      if (!server || server.guildId !== interaction.guildId) {
        await interaction.reply({ content: "Server nicht gefunden.", flags: MessageFlags.Ephemeral });
        return;
      }

      deleteServer(serverId);
      recordAudit({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        actorName: interaction.user.username,
        action: "monitor.server.delete",
        detail: { serverId, name: server.name }
      });
      syncPollJobs(client);

      await interaction.reply({
        content: `**${server.name}** wurde entfernt (inklusive Verlaufsdaten).`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === "edit") {
      const serverId = interaction.options.getString("server", true);
      const server = getServer(serverId);

      if (!server || server.guildId !== interaction.guildId) {
        await interaction.reply({ content: "Server nicht gefunden.", flags: MessageFlags.Ephemeral });
        return;
      }

      const patch = {};
      const name = interaction.options.getString("name");
      const host = interaction.options.getString("host");
      const port = interaction.options.getInteger("port");
      const intervalSeconds = interaction.options.getInteger("intervall");
      const enabled = interaction.options.getBoolean("aktiv");
      const color = interaction.options.getString("farbe");

      if (name !== null) patch.name = name;
      if (host !== null) patch.host = host;
      if (port !== null) patch.port = port;
      if (intervalSeconds !== null) patch.intervalSeconds = intervalSeconds;
      if (enabled !== null) patch.enabled = enabled;
      if (color !== null) patch.color = color;

      if (Object.keys(patch).length === 0) {
        await interaction.reply({
          content: "Es wurde nichts zum Ändern angegeben.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const updated = updateServer(serverId, patch);
      recordAudit({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        actorName: interaction.user.username,
        action: "monitor.server.update",
        detail: { serverId, patch }
      });
      syncPollJobs(client);

      await interaction.reply({
        content: `**${updated.name}** aktualisiert: \`${updated.host}:${updated.port}\`, alle ${updated.intervalSeconds}s, ${updated.enabled ? "aktiv" : "pausiert"}.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === "status") {
      await interaction.deferReply();

      const serverId = interaction.options.getString("server");
      const chartRange = interaction.options.getString("zeitraum") || "24h";
      const servers = serverId
        ? [getServer(serverId)].filter((server) => server && server.guildId === interaction.guildId)
        : listServers(interaction.guildId).filter((server) => server.enabled);

      if (servers.length === 0) {
        await interaction.editReply("Es werden noch keine Server überwacht.");
        return;
      }

      const embeds = servers.slice(0, 5).map((server) => buildServerEmbed(server, { chartRange }).embed);
      await interaction.editReply({ embeds });
      return;
    }

    if (subcommand === "vergleich") {
      await interaction.deferReply();

      const range = resolveRange(interaction.options.getString("zeitraum") || "7d");
      const servers = listServers(interaction.guildId).filter((server) => server.enabled);
      const now = Date.now();

      const series = servers.map((server) => ({
        name: server.name,
        color: server.color,
        points: getSeries(server.id, { from: now - range.ms, to: now, resolution: range.resolution }).points
      }));

      const url = buildMultiServerChartUrl(series, { title: `Serververgleich · ${range.label}` });
      if (!url) {
        await interaction.editReply("Noch nicht genug Messdaten für einen Vergleich.");
        return;
      }

      await interaction.editReply({
        embeds: [{ title: `Serververgleich · ${range.label}`, color: 0x5865f2, image: { url } }]
      });
      return;
    }

    if (subcommand === "top") {
      const serverId = interaction.options.getString("server", true);
      const server = getServer(serverId);

      if (!server || server.guildId !== interaction.guildId) {
        await interaction.reply({ content: "Server nicht gefunden.", flags: MessageFlags.Ephemeral });
        return;
      }

      const players = getTopPlayers(server.id, { sinceMs: 30 * DAY_MS, limit: 15 });
      if (players.length === 0) {
        await interaction.reply({
          content: "Noch keine Spielzeit erfasst. Für SteamID-genaue Spielzeit wird das Ingest-Addon benötigt.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      await interaction.reply({
        embeds: [{
          title: `Top-Spielzeit · ${server.name} (30 Tage)`,
          color: 0x5865f2,
          description: players
            .map((player, index) => `**${index + 1}.** ${player.name || player.steamId} — ${formatDuration(player.seconds)}`)
            .join("\n")
        }]
      });
    }
  }
};
