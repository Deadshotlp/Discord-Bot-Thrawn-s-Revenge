import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { DAY_MS, getSeries } from "./history.js";
import { MAX_IMAGE_URL_LENGTH, buildHourProfileChartUrl, buildPlayerHistoryChartUrl } from "./chart.js";
import { buildServerSummary } from "./stats.js";

const RANGE_PRESETS = {
  "24h": { ms: DAY_MS, label: "24 Stunden", resolution: "raw" },
  "7d": { ms: 7 * DAY_MS, label: "7 Tage", resolution: "hour" },
  "30d": { ms: 30 * DAY_MS, label: "30 Tage", resolution: "day" }
};

export function resolveRange(rangeKey) {
  return RANGE_PRESETS[rangeKey] || RANGE_PRESETS["24h"];
}

/**
 * Letzte Sicherung: Discord lehnt die gesamte Nachricht ab, wenn eine
 * Bild-URL zu lang ist. Lieber ein Embed ohne Diagramm als ein Panel, das
 * gar nicht mehr aktualisiert werden kann.
 */
function usableImageUrl(url) {
  return url && url.length <= MAX_IMAGE_URL_LENGTH ? url : "";
}

function progressBar(percent, size = 12) {
  const safe = Math.max(0, Math.min(100, Number(percent || 0)));
  const filled = Math.round((safe / 100) * size);
  return `${"█".repeat(filled)}${"░".repeat(size - filled)}`;
}

function formatTrend(trendPercent) {
  if (trendPercent === null || trendPercent === undefined) {
    return "–";
  }

  if (trendPercent > 2) {
    return `📈 +${trendPercent} %`;
  }

  if (trendPercent < -2) {
    return `📉 ${trendPercent} %`;
  }

  return `➖ ${trendPercent} %`;
}

function formatUptime(value) {
  return value === null || value === undefined ? "–" : `${value} %`;
}

function formatRelative(timestamp) {
  return timestamp ? `<t:${Math.floor(timestamp / 1000)}:R>` : "–";
}

export function buildServerEmbed(server, { chartRange = "24h", withChart = true, now = Date.now() } = {}) {
  const summary = buildServerSummary(server, { now });
  const current = summary.current;
  const online = Boolean(current?.online) && !current?.stale;

  const embed = new EmbedBuilder()
    .setTitle(`${online ? "🟢" : "🔴"} ${server.name}`)
    .setColor(online ? server.color || "#57f287" : "#ed4245")
    .setFooter({ text: `${server.host}:${server.port} · Abtastung alle ${server.intervalSeconds}s` })
    .setTimestamp(current?.takenAt || now);

  if (!current) {
    embed.setDescription("Noch keine Messwerte – der erste Abruf läuft in Kürze.");
    return { embed, summary };
  }

  if (!online) {
    embed.setDescription(
      current.stale
        ? `Keine aktuellen Daten. Letzte Messung ${formatRelative(current.takenAt)}.`
        : `Server ist offline. Letzte Messung ${formatRelative(current.takenAt)}.`
    );
  }

  const fields = [];

  if (online) {
    const fill = summary.fillPercent ?? 0;
    fields.push({
      name: "Spieler",
      value: `**${current.players}** / ${current.maxPlayers}\n\`${progressBar(fill)}\` ${fill} %`,
      inline: true
    });

    fields.push({
      name: "Map",
      value: current.map ? `\`${current.map}\`` : "–",
      inline: true
    });

    fields.push({
      name: "Ping",
      value: current.latencyMs ? `${current.latencyMs} ms` : "–",
      inline: true
    });
  }

  fields.push({
    name: "Ø / Peak (24 h)",
    value: `${summary.averages.last24h} / **${summary.peaks.last24h.peak}**`,
    inline: true
  });

  fields.push({
    name: "Ø / Peak (7 T)",
    value: `${summary.averages.last7d} / **${summary.peaks.last7d.peak}**`,
    inline: true
  });

  fields.push({
    name: "Trend vs. Vortag",
    value: formatTrend(summary.trendPercent),
    inline: true
  });

  fields.push({
    name: "Uptime 24 h / 7 T",
    value: `${formatUptime(summary.uptime.last24h)} / ${formatUptime(summary.uptime.last7d)}`,
    inline: true
  });

  if (summary.uniquePlayers.last7d > 0) {
    fields.push({
      name: "Einzelspieler 7 T / 30 T",
      value: `${summary.uniquePlayers.last7d} / ${summary.uniquePlayers.last30d}`,
      inline: true
    });
  }

  if (summary.bestHour) {
    fields.push({
      name: "Primetime",
      value: `${String(summary.bestHour.hour).padStart(2, "0")}:00 Uhr · Ø ${summary.bestHour.average}`,
      inline: true
    });
  }

  if (summary.topMaps.length > 0 && server.kind === "source") {
    fields.push({
      name: "Meistgespielte Maps (7 T)",
      value: summary.topMaps
        .slice(0, 3)
        .map((entry) => `\`${entry.map}\` · Ø ${entry.average}`)
        .join("\n"),
      inline: false
    });
  }

  embed.addFields(fields.slice(0, 25));

  if (withChart) {
    const range = resolveRange(chartRange);
    const series = getSeries(server.id, {
      from: now - range.ms,
      to: now,
      resolution: range.resolution
    });

    const chartUrl = usableImageUrl(buildPlayerHistoryChartUrl(series.points, {
      color: server.color,
      title: `Spielerverlauf · ${range.label}`
    }));

    if (chartUrl) {
      embed.setImage(chartUrl);
    }
  }

  return { embed, summary };
}

export function buildHourProfileEmbed(server, summary) {
  const url = usableImageUrl(buildHourProfileChartUrl(summary.hourProfile, {
    color: server.color,
    title: `${server.name} · Aktivität nach Uhrzeit (14 Tage)`
  }));

  if (!url) {
    return null;
  }

  return new EmbedBuilder().setColor(server.color || "#5865f2").setImage(url);
}

export function buildConnectRow(servers) {
  const buttons = servers
    .map((server) => {
      const link = server.connectLink;
      if (!link || !/^https?:\/\//i.test(link)) {
        return null;
      }

      return new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setURL(link)
        .setLabel(`${server.name} beitreten`.slice(0, 80));
    })
    .filter(Boolean)
    .slice(0, 5);

  if (buttons.length === 0) {
    return null;
  }

  return new ActionRowBuilder().addComponents(buttons);
}

/**
 * Baut die komplette Panel-Nachricht: ein Embed pro Server (max. 10)
 * plus optional das Tagesprofil des ersten Servers.
 */
export function buildPanelPayload(servers, { chartRange = "24h", showHourProfile = false, now = Date.now() } = {}) {
  const embeds = [];
  const summaries = [];

  for (const server of servers.slice(0, 10)) {
    const { embed, summary } = buildServerEmbed(server, { chartRange, now });
    embeds.push(embed);
    summaries.push(summary);
  }

  if (embeds.length === 0) {
    embeds.push(
      new EmbedBuilder()
        .setTitle("Server-Monitoring")
        .setColor("#5865f2")
        .setDescription("Es sind noch keine Server hinterlegt. Füge sie im Web-Dashboard oder mit `/server add` hinzu.")
    );
  }

  if (showHourProfile && servers.length > 0 && summaries.length > 0 && embeds.length < 10) {
    const profileEmbed = buildHourProfileEmbed(servers[0], summaries[0]);
    if (profileEmbed) {
      embeds.push(profileEmbed);
    }
  }

  const components = [];
  const connectRow = buildConnectRow(summaries.map((summary) => summary.server));
  if (connectRow) {
    components.push(connectRow);
  }

  return { embeds, components, summaries };
}

export async function upsertPanelMessage(channel, payload, storedMessageId) {
  if (storedMessageId) {
    const existing = await channel.messages.fetch(storedMessageId).catch(() => null);
    if (existing) {
      return existing.edit({ embeds: payload.embeds, components: payload.components });
    }
  }

  return channel.send({ embeds: payload.embeds, components: payload.components });
}
