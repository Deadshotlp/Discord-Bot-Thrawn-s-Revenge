import { abmeldungCommand } from "./commands/abmeldung.js";
import { ABSENCE_DEFAULT_CONFIG, normalizeAbsenceConfig } from "./services/config.js";
import { refreshOverview, runDailyMaintenance } from "./services/announce.js";
import { refreshAbsencePanel } from "./services/panel.js";
import { handleAbsencePanelInteraction } from "./handlers/panelHandlers.js";

const JOB_NAME = "absence:daily";

// Merkt sich den zuletzt gesehenen Panel-Channel je Server. Ohne das würde das
// Speichern der Nachrichten-ID einen weiteren Änderungslauf auslösen.
const lastPanelChannel = new Map();

function panelChannelOf(client, guildId) {
  const state = client.botContext.settingsStore.getModuleState(guildId, "absence");
  return normalizeAbsenceConfig(state?.config).panelChannelId;
}

async function handleReady({ client }) {
  const { scheduler, settingsStore, logger } = client.botContext;

  // Stündlich prüfen reicht: Start-/Endmeldungen sind tagesgenau, die
  // Übersicht bleibt dadurch trotzdem aktuell.
  scheduler.every(JOB_NAME, 60 * 60 * 1000, async () => {
    for (const guild of client.guilds.cache.values()) {
      if (!settingsStore.isModuleEnabled(guild.id, "absence")) {
        continue;
      }

      await runDailyMaintenance(client, guild.id).catch((error) => {
        logger.warn("Abmelde-Wartung fehlgeschlagen", { guildId: guild.id, error: String(error) });
      });
    }
  });

  for (const guild of client.guilds.cache.values()) {
    lastPanelChannel.set(guild.id, panelChannelOf(client, guild.id));

    if (settingsStore.isModuleEnabled(guild.id, "absence")) {
      await refreshAbsencePanel(client, guild.id).catch(() => null);
    }
  }

  settingsStore.onChange(({ guildId, moduleName }) => {
    if (moduleName !== "absence" || !guildId) {
      return;
    }

    refreshOverview(client, guildId).catch(() => null);

    const channelId = panelChannelOf(client, guildId);
    if (lastPanelChannel.get(guildId) === channelId) {
      // Nur die Nachrichten-ID wurde gespeichert – kein Anlass für einen Lauf.
      return;
    }

    lastPanelChannel.set(guildId, channelId);
    refreshAbsencePanel(client, guildId).catch((error) => {
      logger.warn("Abmelde-Panel konnte nicht gesetzt werden", { guildId, error: String(error) });
    });
  });
}

async function handleShutdown({ client }) {
  client.botContext.scheduler.cancel(JOB_NAME);
  lastPanelChannel.clear();
}

handleShutdown.alwaysAvailable = true;

export const absenceModule = {
  name: "absence",
  label: "Team-Abmeldungen",
  description: "Abwesenheiten pro Department erfassen, ankündigen und als Übersicht pflegen.",
  defaultEnabled: false,
  defaultConfig: { ...ABSENCE_DEFAULT_CONFIG },
  commands: [abmeldungCommand],
  events: {
    ready: [handleReady],
    interactionCreate: [handleAbsencePanelInteraction],
    shutdown: [handleShutdown]
  }
};
