import { teamCommand } from "./commands/team.js";
import { clearMemberCache } from "./services/roster.js";

async function handleReady({ client }) {
  const { env, logger, settingsStore } = client.botContext;

  if (env.guildMembersIntent) {
    return;
  }

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
}

async function handleShutdown() {
  clearMemberCache();
}

handleShutdown.alwaysAvailable = true;

export const teamListModule = {
  name: "teamList",
  label: "Teamliste",
  description:
    "Übersicht aller Teammitglieder nach Departments, mit Kennzeichnung der Leitung "
    + "und aktueller Abmeldungen. Benötigt das Server-Members-Intent.",
  defaultEnabled: false,
  defaultConfig: {},
  commands: [teamCommand],
  events: {
    ready: [handleReady],
    shutdown: [handleShutdown]
  }
};
