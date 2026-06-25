import { ChannelType, MessageFlags } from "discord.js";
import { canManageServer } from "../../core/permissions.js";
import { serverStatusCommand } from "./commands/serverStatus.js";
import { normalizeServerHost, normalizeServerPort, normalizeServerStatusConfig } from "./services/config.js";
import {
  buildDailyPlayerStats,
  getServerStatusSnapshotsSince,
  pruneServerStatusSnapshotsOlderThan,
  recordServerStatusSnapshot
} from "./services/history.js";
import {
  buildServerStatusPanelPayload,
  buildServerStatusPanelPayloadWithoutButton,
  buildServerStatusSetupModal,
  SERVER_STATUS_SETUP_CHANNEL_INPUT_ID,
  SERVER_STATUS_SETUP_HOST_INPUT_ID,
  SERVER_STATUS_SETUP_MODAL_ID,
  SERVER_STATUS_SETUP_PORT_INPUT_ID,
  upsertServerStatusPanelMessage
} from "./services/panel.js";
import { fetchGameServerStatus } from "./services/query.js";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const runtime = {
  timer: null,
  running: false
};

function getPollIntervalMs(env) {
  const seconds = Number.parseInt(String(env.serverStatusPollIntervalSeconds || 300), 10);
  const safeSeconds = Number.isInteger(seconds) ? Math.max(60, seconds) : 300;
  return safeSeconds * 1000;
}

async function resolveStatusChannel(guild, channelId) {
  if (!channelId) {
    return null;
  }

  const channel = guild.channels.cache.get(channelId)
    || (await guild.channels.fetch(channelId).catch(() => null));

  if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
    return null;
  }

  return channel;
}

async function sendPanelPayload(channel, payload, storedMessageId) {
  try {
    return await upsertServerStatusPanelMessage(channel, payload, storedMessageId);
  } catch {
    return upsertServerStatusPanelMessage(channel, buildServerStatusPanelPayloadWithoutButton(payload), storedMessageId);
  }
}

async function pollGuild(client, guild) {
  const { moduleConfigStore } = client.botContext;
  const moduleState = moduleConfigStore.getModuleState(guild.id, "server-status");
  const config = normalizeServerStatusConfig(moduleState?.config);

  if (!config.serverHost) {
    return;
  }

  const status = await fetchGameServerStatus(config.serverHost, config.serverPort);

  recordServerStatusSnapshot({
    guildId: guild.id,
    online: status.online,
    playerCount: status.online ? status.players : 0,
    maxPlayers: status.online ? status.maxPlayers : 0,
    map: status.online ? status.map : ""
  });
  pruneServerStatusSnapshotsOlderThan(guild.id, Date.now() - HISTORY_RETENTION_MS);

  moduleConfigStore.setModuleConfig(guild.id, "server-status", {
    ...config,
    lastOnline: status.online,
    lastMap: status.online ? status.map : "",
    lastPlayers: status.online ? status.players : 0,
    lastMaxPlayers: status.online ? status.maxPlayers : 0
  });

  const statusChannel = await resolveStatusChannel(guild, config.statusChannelId);
  if (!statusChannel) {
    return;
  }

  const snapshots = getServerStatusSnapshotsSince(guild.id, Date.now() - SEVEN_DAYS_MS);
  const dailyStats = buildDailyPlayerStats(snapshots);
  const payload = buildServerStatusPanelPayload({
    host: config.serverHost,
    port: config.serverPort,
    status,
    dailyStats
  });

  const message = await sendPanelPayload(statusChannel, payload, config.statusMessageId).catch((error) => {
    client.botContext.logger.warn("Server-Status Panel konnte nicht aktualisiert werden", {
      guildId: guild.id,
      error: String(error)
    });
    return null;
  });

  if (message && message.id !== config.statusMessageId) {
    moduleConfigStore.setModuleConfig(guild.id, "server-status", {
      ...config,
      statusMessageId: message.id,
      lastOnline: status.online,
      lastMap: status.online ? status.map : "",
      lastPlayers: status.online ? status.players : 0,
      lastMaxPlayers: status.online ? status.maxPlayers : 0
    });
  }
}

async function runPollCycleSafe(client) {
  if (runtime.running) {
    return;
  }

  runtime.running = true;
  try {
    for (const guild of client.guilds.cache.values()) {
      if (!client.botContext.moduleConfigStore.isModuleEnabled(guild.id, "server-status")) {
        continue;
      }

      await pollGuild(client, guild).catch((error) => {
        client.botContext.logger.warn("Server-Status Polling fehlgeschlagen", {
          guildId: guild.id,
          error: String(error)
        });
      });
    }
  } finally {
    runtime.running = false;
  }
}

async function handleServerStatusReady({ client }) {
  if (runtime.timer) {
    return;
  }

  const intervalMs = getPollIntervalMs(client.botContext.env);
  await runPollCycleSafe(client);

  runtime.timer = setInterval(() => {
    runPollCycleSafe(client).catch((error) => {
      client.botContext.logger.warn("Server-Status Polling fehlgeschlagen", {
        error: String(error)
      });
    });
  }, intervalMs);
}

async function handleServerStatusInteraction({ client, interaction }) {
  if (!interaction.isModalSubmit() || interaction.customId !== SERVER_STATUS_SETUP_MODAL_ID) {
    return;
  }

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "Dieses Setup funktioniert nur auf einem Server.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!canManageServer(interaction.member)) {
    await interaction.reply({
      content: "Nur Admins oder Mitglieder mit Server-verwalten dürfen dies konfigurieren.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const hostInput = interaction.fields.getTextInputValue(SERVER_STATUS_SETUP_HOST_INPUT_ID)?.trim() || "";
  const portInput = interaction.fields.getTextInputValue(SERVER_STATUS_SETUP_PORT_INPUT_ID)?.trim() || "";
  const channelInput = interaction.fields.getTextInputValue(SERVER_STATUS_SETUP_CHANNEL_INPUT_ID)?.trim() || "";

  const serverHost = normalizeServerHost(hostInput);
  if (!serverHost) {
    await interaction.reply({
      content: "Ungültige Server-IP/Hostname. Bitte erneut versuchen.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const serverPort = normalizeServerPort(portInput);

  let statusChannelId = "";
  if (channelInput) {
    const channelId = (channelInput.match(/\d{16,20}/g) || []).at(-1) || "";
    const channel = await resolveStatusChannel(interaction.guild, channelId);
    if (!channel) {
      await interaction.reply({
        content: "Status-Channel ist ungültig. Bitte ID oder #Erwähnung eines Textkanals nutzen.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    statusChannelId = channel.id;
  }

  const { moduleConfigStore } = client.botContext;
  const moduleState = moduleConfigStore.getModuleState(interaction.guildId, "server-status");
  const currentConfig = normalizeServerStatusConfig(moduleState?.config);

  moduleConfigStore.setModuleConfig(interaction.guildId, "server-status", {
    ...currentConfig,
    serverHost,
    serverPort,
    statusChannelId,
    statusMessageId: statusChannelId === currentConfig.statusChannelId ? currentConfig.statusMessageId : ""
  });

  await interaction.reply({
    content: [
      `Server gesetzt: \`${serverHost}:${serverPort}\``,
      statusChannelId
        ? `Status-Channel: <#${statusChannelId}>`
        : "Status-Channel: keiner (kein Live-Panel, /server-status funktioniert weiterhin)."
    ].join("\n"),
    flags: MessageFlags.Ephemeral
  });
}

handleServerStatusInteraction.alwaysAvailable = true;

export const serverStatusModule = {
  name: "server-status",
  defaultEnabled: false,
  defaultConfig: {
    serverHost: "",
    serverPort: 27015,
    statusChannelId: "",
    statusMessageId: "",
    lastOnline: false,
    lastMap: "",
    lastPlayers: 0,
    lastMaxPlayers: 0
  },
  commands: [serverStatusCommand],
  events: {
    ready: [handleServerStatusReady],
    interactionCreate: [handleServerStatusInteraction]
  }
};
