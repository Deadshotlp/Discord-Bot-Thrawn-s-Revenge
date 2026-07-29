import { serverCommand } from "./commands/server.js";
import { MONITORING_DEFAULT_CONFIG } from "./services/config.js";
import { syncPollJobs, stopPollJobs } from "./services/poller.js";

async function handleReady({ client }) {
  const { settingsStore } = client.botContext;

  // Änderungen aus dem Web-Dashboard sollen sofort greifen.
  settingsStore.onChange(({ moduleName }) => {
    if (moduleName === "monitoring") {
      syncPollJobs(client);
    }
  });

  syncPollJobs(client);
}

handleReady.alwaysAvailable = true;

async function handleShutdown({ client }) {
  stopPollJobs(client);
}

handleShutdown.alwaysAvailable = true;

export const monitoringModule = {
  name: "monitoring",
  label: "Server-Monitoring",
  description: "Überwacht beliebig viele Game- und Webserver, sammelt Verlaufsdaten und postet ein Live-Panel.",
  defaultEnabled: false,
  defaultConfig: { ...MONITORING_DEFAULT_CONFIG },
  commands: [serverCommand],
  events: {
    ready: [handleReady],
    shutdown: [handleShutdown]
  }
};
