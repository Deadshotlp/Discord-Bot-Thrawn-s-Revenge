import { teamCommand } from "./commands/team.js";
import { TEAM_LIST_DEFAULT_CONFIG, normalizeTeamListConfig } from "./services/config.js";
import { cancelPendingRefreshes, refreshPanel, schedulePanelRefresh } from "./services/panel.js";
import { clearMemberCache } from "./services/roster.js";

const JOB_NAME = "teamList:refresh";

// Merkt sich den zuletzt gesehenen Channel je Server. Ohne das würde das
// Speichern der Nachrichten-ID einen weiteren Änderungslauf auslösen.
const lastChannel = new Map();

function panelChannelOf(client, guildId) {
  const state = client.botContext.settingsStore.getModuleState(guildId, "teamList");
  return normalizeTeamListConfig(state?.config).panelChannelId;
}

async function handleReady({ client }) {
  const { env, logger, settingsStore } = client.botContext;

  if (!env.guildMembersIntent) {
    // Ohne das Intent kann der Bot die Mitgliederliste nicht abrufen. Lieber
    // beim Start einmal deutlich warnen als später bei jedem Befehl.
    const affected = [...client.guilds.cache.values()]
      .filter((guild) => settingsStore.isModuleEnabled(guild.id, "teamList"))
      .map((guild) => guild.name);

    if (affected.length > 0) {
      logger.warn(
        "Teamliste ist aktiv, aber GUILD_MEMBERS_INTENT=false – der Befehl /team liste wird fehlschlagen",
        { guilds: affected }
      );
    }

    return;
  }

  for (const guild of client.guilds.cache.values()) {
    lastChannel.set(guild.id, panelChannelOf(client, guild.id));
  }

  // Sicherheitsnetz neben den Ereignissen: Abmeldungen beginnen und enden
  // tagesgenau, das sieht der Bot ohne eigenen Anlass sonst nicht.
  const shortest = Math.min(
    ...[...client.guilds.cache.values()].map((guild) => {
      const state = settingsStore.getModuleState(guild.id, "teamList");
      return normalizeTeamListConfig(state?.config).refreshMinutes;
    }),
    30
  );

  client.botContext.scheduler.every(JOB_NAME, shortest * 60 * 1000, async () => {
    for (const guild of client.guilds.cache.values()) {
      if (!settingsStore.isModuleEnabled(guild.id, "teamList")) {
        continue;
      }

      await refreshPanel(client, guild.id).catch((error) => {
        logger.warn("Teamliste konnte nicht aktualisiert werden", {
          guildId: guild.id,
          error: String(error)
        });
      });
    }
  }, { runImmediately: false });

  settingsStore.onChange(({ guildId, moduleName }) => {
    if (!guildId) {
      return;
    }

    // Departments werden im Support-Modul gepflegt und bestimmen Gruppierung
    // und Reihenfolge der Liste.
    if (moduleName === "support") {
      schedulePanelRefresh(client, guildId, 1000);
      return;
    }

    if (moduleName !== "teamList") {
      return;
    }

    const channelId = panelChannelOf(client, guildId);
    if (lastChannel.get(guildId) === channelId) {
      // Nur die Nachrichten-ID wurde gespeichert – kein Anlass für einen Lauf.
      return;
    }

    lastChannel.set(guildId, channelId);
    schedulePanelRefresh(client, guildId, 1000);
  });
}

/**
 * Rollen, Beitritte und Austritte ändern die Teamliste unmittelbar. Der
 * Zwischenspeicher wird verworfen, damit Dashboard und Nachricht denselben
 * Stand zeigen.
 */
async function handleMemberChange({ client, guild }) {
  if (!guild) {
    return;
  }

  clearMemberCache(guild.id);
  schedulePanelRefresh(client, guild.id);
}

async function handleShutdown({ client }) {
  client.botContext.scheduler.cancel(JOB_NAME);
  cancelPendingRefreshes();
  clearMemberCache();
  lastChannel.clear();
}

handleShutdown.alwaysAvailable = true;

export const teamListModule = {
  name: "teamList",
  label: "Teamliste",
  description:
    "Übersicht aller Teammitglieder nach Departments, mit Kennzeichnung der Leitung "
    + "und aktueller Abmeldungen. Benötigt das Server-Members-Intent.",
  defaultEnabled: false,
  defaultConfig: { ...TEAM_LIST_DEFAULT_CONFIG },
  commands: [teamCommand],
  events: {
    ready: [handleReady],
    guildMemberAdd: [handleMemberChange],
    guildMemberRemove: [handleMemberChange],
    guildMemberUpdate: [handleMemberChange],
    shutdown: [handleShutdown]
  }
};
