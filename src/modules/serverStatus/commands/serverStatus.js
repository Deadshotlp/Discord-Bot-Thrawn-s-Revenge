import { SlashCommandBuilder } from "discord.js";
import { normalizeServerStatusConfig } from "../services/config.js";
import { buildDailyPlayerStats, getServerStatusSnapshotsSince } from "../services/history.js";
import { buildServerStatusPanelPayload } from "../services/panel.js";
import { fetchGameServerStatus } from "../services/query.js";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export const serverStatusCommand = {
  data: new SlashCommandBuilder()
    .setName("server-status")
    .setDescription("Zeigt den aktuellen Status des Game-Servers."),

  async execute({ client, interaction }) {
    await interaction.deferReply();

    const { moduleConfigStore } = client.botContext;
    const moduleState = moduleConfigStore.getModuleState(interaction.guildId, "server-status");
    const config = normalizeServerStatusConfig(moduleState?.config);

    if (!config.serverHost) {
      await interaction.editReply({
        content: "Es ist noch kein Server konfiguriert. Bitte zuerst über das Setup-Panel einrichten."
      });
      return;
    }

    const status = await fetchGameServerStatus(config.serverHost, config.serverPort);
    const sinceTimestamp = Date.now() - SEVEN_DAYS_MS;
    const snapshots = getServerStatusSnapshotsSince(interaction.guildId, sinceTimestamp);
    const dailyStats = buildDailyPlayerStats(snapshots);

    const payload = buildServerStatusPanelPayload({
      host: config.serverHost,
      port: config.serverPort,
      status,
      dailyStats
    });

    await interaction.editReply(payload).catch(async () => {
      await interaction.editReply({ embeds: payload.embeds, components: [] });
    });
  }
};
