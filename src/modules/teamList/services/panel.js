import { resolveTextAnnouncementChannel } from "../../../core/discordUtil.js";
import { normalizeTeamListConfig } from "./config.js";
import { buildRosterEmbeds } from "./render.js";
import { MemberIntentError, collectRoster } from "./roster.js";

// Rollenänderungen kommen in Schüben (Rolle entfernt, Nickname geändert …).
// Ein kurzer Sammelmoment verhindert, dass für jede Einzeländerung eine
// eigene Nachricht bearbeitet wird.
const DEBOUNCE_MS = 5000;
const pending = new Map();

/**
 * Zeichnet die dauerhaft gepflegte Teamliste im konfigurierten Channel neu.
 * Ohne Channel passiert nichts – die Nachricht ist optional.
 */
export async function refreshPanel(client, guildId, { force = true } = {}) {
  const { settingsStore, logger } = client.botContext;
  const config = normalizeTeamListConfig(settingsStore.getModuleState(guildId, "teamList")?.config);

  if (!config.panelChannelId) {
    return null;
  }

  const guild = client.guilds.cache.get(String(guildId));
  if (!guild) {
    return null;
  }

  const channel = await resolveTextAnnouncementChannel(guild, config.panelChannelId);
  if (!channel) {
    logger.warn("Teamlisten-Channel nicht erreichbar", { guildId, channelId: config.panelChannelId });
    return null;
  }

  let roster;

  try {
    roster = await collectRoster(client, guildId, { force });
  } catch (error) {
    if (error instanceof MemberIntentError) {
      logger.warn("Teamliste: Mitgliederliste nicht abrufbar", { guildId });
      return null;
    }

    throw error;
  }

  const embeds = buildRosterEmbeds(roster, { guildName: guild.name });

  try {
    if (config.panelMessageId) {
      const existing = await channel.messages.fetch(config.panelMessageId).catch(() => null);
      if (existing) {
        return await existing.edit({ embeds });
      }
    }

    const message = await channel.send({ embeds });
    settingsStore.setModuleConfig(guildId, "teamList", { panelMessageId: message.id });
    return message;
  } catch (error) {
    logger.warn("Teamliste konnte nicht aktualisiert werden", { guildId, error: String(error) });
    return null;
  }
}

export function schedulePanelRefresh(client, guildId, delayMs = DEBOUNCE_MS) {
  const key = String(guildId);
  clearTimeout(pending.get(key));

  const timer = setTimeout(() => {
    pending.delete(key);

    refreshPanel(client, key).catch((error) => {
      client.botContext.logger.warn("Teamliste: geplante Aktualisierung fehlgeschlagen", {
        guildId: key,
        error: String(error)
      });
    });
  }, delayMs);

  timer.unref?.();
  pending.set(key, timer);
}

export function cancelPendingRefreshes() {
  for (const timer of pending.values()) {
    clearTimeout(timer);
  }

  pending.clear();
}
