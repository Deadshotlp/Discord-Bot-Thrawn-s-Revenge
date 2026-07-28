import { runContentCreatorPollCycle } from "./services/polling.js";

const JOB_NAME = "content-creator:poll";

function getPollIntervalMs(env) {
  const seconds = Number.parseInt(String(env.creatorPollIntervalSeconds || 180), 10);
  const safeSeconds = Number.isInteger(seconds) ? Math.max(30, seconds) : 180;
  return safeSeconds * 1000;
}

async function handleContentCreatorReady({ client }) {
  const { scheduler, env } = client.botContext;

  scheduler.every(JOB_NAME, getPollIntervalMs(env), () =>
    runContentCreatorPollCycle(client, { reason: "interval" }));
}

async function handleContentCreatorShutdown({ client }) {
  client.botContext.scheduler.cancel(JOB_NAME);
}

handleContentCreatorShutdown.alwaysAvailable = true;

export const contentCreatorModule = {
  name: "content-creator",
  label: "Content-Creator-Benachrichtigungen",
  description: "Meldet neue YouTube-Videos und Twitch-Streams im konfigurierten Channel.",
  defaultEnabled: false,
  defaultConfig: {
    notifyChannelId: "",
    youtubeRoleId: "",
    twitchRoleId: "",
    youtubeChannels: [],
    twitchChannels: []
  },
  commands: [],
  events: {
    ready: [handleContentCreatorReady],
    shutdown: [handleContentCreatorShutdown]
  }
};
