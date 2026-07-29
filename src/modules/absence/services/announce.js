import { EmbedBuilder } from "discord.js";
import { resolveTextAnnouncementChannel } from "../../../core/discordUtil.js";
import { normalizeAbsenceConfig } from "./config.js";
import { getDepartmentName, getDepartments } from "./departments.js";
import {
  ABSENCE_KINDS,
  ABSENCE_STATUS,
  groupByDepartment,
  listCurrentAbsences,
  listUpcomingAbsences,
  setAbsenceAnnounceMessage,
  setAbsenceNotified,
  setAbsenceStatus,
  todayIso
} from "./store.js";

function formatDate(isoDate) {
  const date = new Date(`${isoDate}T12:00:00`);
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function formatRange(absence) {
  if (absence.startsOn === absence.endsOn) {
    return formatDate(absence.startsOn);
  }

  return `${formatDate(absence.startsOn)} – ${formatDate(absence.endsOn)}`;
}

export function describeAbsence(absence, departments) {
  const kind = ABSENCE_KINDS[absence.kind] || ABSENCE_KINDS.abwesend;
  const departmentLabel = absence.departmentIds.length > 0
    ? absence.departmentIds.map((id) => getDepartmentName(departments, id)).join(", ")
    : "Allgemein";

  return {
    kind,
    departmentLabel,
    range: formatRange(absence),
    line: `${kind.emoji} <@${absence.userId}> · **${formatRange(absence)}** (${absence.days} ${absence.days === 1 ? "Tag" : "Tage"})${absence.reason ? ` – ${absence.reason}` : ""}${absence.status === ABSENCE_STATUS.pending ? " · _wartet auf Freigabe_" : ""}`
  };
}

async function resolveChannelForDepartments(client, guildId, config, departmentIds) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    return null;
  }

  for (const departmentId of departmentIds) {
    const channelId = config.departmentChannels[departmentId];
    if (channelId) {
      const channel = await resolveTextAnnouncementChannel(guild, channelId);
      if (channel) {
        return channel;
      }
    }
  }

  return resolveTextAnnouncementChannel(guild, config.announceChannelId);
}

export async function announceAbsence(client, absence, { action = "created" } = {}) {
  const { settingsStore } = client.botContext;
  const config = normalizeAbsenceConfig(settingsStore.getModuleState(absence.guildId, "absence")?.config);
  const departments = getDepartments(client, absence.guildId);
  const channel = await resolveChannelForDepartments(client, absence.guildId, config, absence.departmentIds);

  if (!channel) {
    return null;
  }

  const described = describeAbsence(absence, departments);
  const titles = {
    created: "Neue Abmeldung",
    updated: "Abmeldung geändert",
    cancelled: "Abmeldung zurückgezogen",
    approved: "Abmeldung freigegeben",
    rejected: "Abmeldung abgelehnt"
  };

  const colors = {
    created: 0x5865f2,
    updated: 0xfee75c,
    cancelled: 0x99aab5,
    approved: 0x57f287,
    rejected: 0xed4245
  };

  const embed = new EmbedBuilder()
    .setTitle(`${described.kind.emoji} ${titles[action] || titles.created}`)
    .setColor(colors[action] ?? colors.created)
    .setDescription(`<@${absence.userId}> ist **${described.range}** nicht verfügbar.`)
    .addFields(
      { name: "Art", value: described.kind.label, inline: true },
      { name: "Dauer", value: `${absence.days} ${absence.days === 1 ? "Tag" : "Tage"}`, inline: true },
      { name: "Bereich", value: described.departmentLabel, inline: true }
    )
    .setTimestamp(new Date());

  if (absence.reason) {
    embed.addFields({ name: "Grund", value: absence.reason.slice(0, 1024) });
  }

  if (absence.status === ABSENCE_STATUS.pending) {
    embed.setFooter({ text: "Wartet auf Freigabe durch die Bereichsleitung" });
  }

  const mentions = config.notifyRoleIds.length > 0 && action === "created"
    ? config.notifyRoleIds.map((roleId) => `<@&${roleId}>`).join(" ")
    : undefined;

  const message = await channel.send({ content: mentions, embeds: [embed] }).catch(() => null);
  if (message && action === "created") {
    setAbsenceAnnounceMessage(absence.id, message.id);
  }

  return message;
}

/**
 * Übersichts-Nachricht: wer ist heute weg, wer in den nächsten Wochen –
 * gruppiert nach Department.
 */
export function buildOverviewEmbeds(client, guildId, config) {
  const departments = getDepartments(client, guildId);
  const today = todayIso();
  const current = listCurrentAbsences(guildId, today);
  const upcoming = listUpcomingAbsences(guildId, config.overviewDays, today)
    .filter((absence) => absence.startsOn > today && absence.status !== ABSENCE_STATUS.cancelled);

  const embeds = [];

  const currentEmbed = new EmbedBuilder()
    .setTitle("🚦 Aktuell abgemeldet")
    .setColor(current.length > 0 ? 0xed4245 : 0x57f287)
    .setTimestamp(new Date());

  if (current.length === 0) {
    currentEmbed.setDescription("Heute ist niemand abgemeldet. 🎉");
  } else {
    const grouped = groupByDepartment(current);
    for (const [departmentId, entries] of grouped) {
      currentEmbed.addFields({
        name: getDepartmentName(departments, departmentId),
        value: entries.map((absence) => describeAbsence(absence, departments).line).join("\n").slice(0, 1024)
      });
    }
  }

  embeds.push(currentEmbed);

  const upcomingEmbed = new EmbedBuilder()
    .setTitle(`📅 Geplante Abmeldungen (nächste ${config.overviewDays} Tage)`)
    .setColor(0x5865f2);

  if (upcoming.length === 0) {
    upcomingEmbed.setDescription("Keine geplanten Abmeldungen.");
  } else {
    const grouped = groupByDepartment(upcoming);
    for (const [departmentId, entries] of grouped) {
      upcomingEmbed.addFields({
        name: getDepartmentName(departments, departmentId),
        value: entries
          .slice(0, 12)
          .map((absence) => describeAbsence(absence, departments).line)
          .join("\n")
          .slice(0, 1024)
      });
    }
  }

  embeds.push(upcomingEmbed);
  return embeds;
}

export async function refreshOverview(client, guildId) {
  const { settingsStore, logger } = client.botContext;
  const config = normalizeAbsenceConfig(settingsStore.getModuleState(guildId, "absence")?.config);

  if (!config.overviewChannelId) {
    return null;
  }

  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    return null;
  }

  const channel = await resolveTextAnnouncementChannel(guild, config.overviewChannelId);
  if (!channel) {
    return null;
  }

  const embeds = buildOverviewEmbeds(client, guildId, config);

  try {
    if (config.overviewMessageId) {
      const existing = await channel.messages.fetch(config.overviewMessageId).catch(() => null);
      if (existing) {
        return await existing.edit({ embeds });
      }
    }

    const message = await channel.send({ embeds });
    settingsStore.setModuleConfig(guildId, "absence", { overviewMessageId: message.id });
    return message;
  } catch (error) {
    logger.warn("Abmelde-Übersicht konnte nicht aktualisiert werden", {
      guildId,
      error: String(error)
    });
    return null;
  }
}

/**
 * Tagesaufgabe: Beginn/Ende melden, abgelaufene Einträge stilllegen
 * und die Übersicht neu zeichnen.
 */
export async function runDailyMaintenance(client, guildId) {
  const { settingsStore } = client.botContext;
  const config = normalizeAbsenceConfig(settingsStore.getModuleState(guildId, "absence")?.config);
  const departments = getDepartments(client, guildId);
  const today = todayIso();
  const guild = client.guilds.cache.get(guildId);

  if (!guild) {
    return;
  }

  const relevant = listUpcomingAbsences(guildId, config.overviewDays, today)
    .filter((absence) => absence.status === ABSENCE_STATUS.active);

  for (const absence of relevant) {
    if (absence.startsOn === today && !absence.notifiedStart) {
      const channel = await resolveChannelForDepartments(client, guildId, config, absence.departmentIds);
      if (channel) {
        const described = describeAbsence(absence, departments);
        await channel.send({
          content: `${described.kind.emoji} <@${absence.userId}> ist ab heute nicht verfügbar (bis ${formatDate(absence.endsOn)}).`
        }).catch(() => null);
      }

      setAbsenceNotified(absence.id, { start: true });
    }
  }

  // Abgelaufene Einträge werden geschlossen, bleiben aber für Statistiken erhalten.
  for (const absence of listUpcomingAbsences(guildId, 0, today)) {
    if (absence.endsOn < today && absence.status === ABSENCE_STATUS.active && !absence.notifiedEnd) {
      setAbsenceNotified(absence.id, { end: true });
      setAbsenceStatus(absence.id, ABSENCE_STATUS.active);
    }
  }

  await refreshOverview(client, guildId);
}

export { formatDate, formatRange };
