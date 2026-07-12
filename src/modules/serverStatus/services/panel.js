import {
  ActionRowBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { buildPlayerHistoryChartUrl } from "./chart.js";

export const SERVER_STATUS_SETUP_MODAL_ID = "server_status_setup_modal";
export const SERVER_STATUS_SETUP_HOST_INPUT_ID = "server_status_setup_host";
export const SERVER_STATUS_SETUP_PORT_INPUT_ID = "server_status_setup_port";
export const SERVER_STATUS_SETUP_CHANNEL_INPUT_ID = "server_status_setup_channel";

const ONLINE_COLOR = 0x2ecc71;
const OFFLINE_COLOR = 0xe74c3c;
const SERVER_STATUS_PANEL_TITLE_PREFIX = "Server-Status:";

function formatGermanClock(value = Date.now()) {
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(value instanceof Date ? value : new Date(value));
}

function buildConnectAddress(host, port) {
  return `${host}:${port}`;
}

export function buildServerStatusPanelPayload({ host, port, status, dailyStats = [] }) {
  const connectAddress = buildConnectAddress(host, port);
  const online = Boolean(status?.online);

  const embed = new EmbedBuilder()
    .setColor(online ? ONLINE_COLOR : OFFLINE_COLOR)
    .setTitle(`${SERVER_STATUS_PANEL_TITLE_PREFIX} ${online ? (status.name || host) : host}`)
    .addFields(
      {
        name: "Status",
        value: online ? "🟢 Online" : "🔴 Offline",
        inline: true
      },
      {
        name: "Spieler",
        value: online ? `${status.players}/${status.maxPlayers}` : "-",
        inline: true
      },
      {
        name: "Map",
        value: online ? (status.map || "-") : "-",
        inline: true
      },
      {
        name: "Connect",
        value: `\`connect ${connectAddress}\``
      }
    )
    .setFooter({ text: `Zuletzt aktualisiert um ${formatGermanClock()} Uhr` });

  const chartUrl = buildPlayerHistoryChartUrl(dailyStats);
  if (chartUrl) {
    embed.setImage(chartUrl);
  }

  const connectButtonRow = {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        style: ButtonStyle.Link,
        label: "Direct Connect",
        url: `steam://connect/${connectAddress}`
      }
    ]
  };

  return {
    embeds: [embed],
    components: [connectButtonRow]
  };
}

export function buildServerStatusPanelPayloadWithoutButton(payload) {
  return {
    embeds: payload.embeds,
    components: []
  };
}

export function buildServerStatusSetupModal(config = {}) {
  const modal = new ModalBuilder()
    .setCustomId(SERVER_STATUS_SETUP_MODAL_ID)
    .setTitle("Server-Status Setup");

  const hostInput = new TextInputBuilder()
    .setCustomId(SERVER_STATUS_SETUP_HOST_INPUT_ID)
    .setLabel("Server-IP oder Hostname")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("z.B. 123.45.67.89")
    .setMaxLength(120);

  if (config.serverHost) {
    hostInput.setValue(config.serverHost);
  }

  const portInput = new TextInputBuilder()
    .setCustomId(SERVER_STATUS_SETUP_PORT_INPUT_ID)
    .setLabel("Server-Port")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder("Standard: 27015")
    .setMaxLength(5);

  if (config.serverPort) {
    portInput.setValue(String(config.serverPort));
  }

  const channelInput = new TextInputBuilder()
    .setCustomId(SERVER_STATUS_SETUP_CHANNEL_INPUT_ID)
    .setLabel("Status-Channel (ID oder #Erwähnung)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder("Leer = kein Live-Panel");

  if (config.statusChannelId) {
    channelInput.setValue(config.statusChannelId);
  }

  modal.addComponents(
    new ActionRowBuilder().addComponents(hostInput),
    new ActionRowBuilder().addComponents(portInput),
    new ActionRowBuilder().addComponents(channelInput)
  );

  return modal;
}

function isServerStatusPanelMessage(message, botUserId) {
  if (!message || message.author?.id !== botUserId) {
    return false;
  }

  return Boolean(message.embeds?.[0]?.title?.startsWith(SERVER_STATUS_PANEL_TITLE_PREFIX));
}

export async function upsertServerStatusPanelMessage(channel, payload, storedMessageId) {
  if (storedMessageId) {
    const existing = await channel.messages.fetch(storedMessageId).catch(() => null);
    if (existing) {
      const edited = await existing.edit(payload).catch(() => null);
      if (edited) {
        return edited;
      }
    }
  }

  const recentMessages = await channel.messages.fetch({ limit: 30 }).catch(() => null);
  const existingPanel = recentMessages?.find((message) => isServerStatusPanelMessage(message, channel.client.user?.id));

  if (existingPanel) {
    const edited = await existingPanel.edit(payload).catch(() => null);
    if (edited) {
      return edited;
    }
  }

  return channel.send(payload);
}
