import { abmeldungCommand } from "./commands/abmeldung.js";
import { ABSENCE_DEFAULT_CONFIG } from "./services/config.js";
import { refreshOverview, runDailyMaintenance } from "./services/announce.js";

const JOB_NAME = "absence:daily";

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

  settingsStore.onChange(({ guildId, moduleName }) => {
    if (moduleName === "absence" && guildId) {
      refreshOverview(client, guildId).catch(() => null);
    }
  });
}

async function handleShutdown({ client }) {
  client.botContext.scheduler.cancel(JOB_NAME);
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
    shutdown: [handleShutdown]
  }
};
