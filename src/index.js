import {
  Client,
  GatewayIntentBits,
  Partials
} from "discord.js";

import { env } from "./config/env.js";
import { closeDb } from "./core/db.js";
import { SettingsStore } from "./core/settingsStore.js";
import { Scheduler } from "./core/scheduler.js";
import { createLogger } from "./core/logger.js";
import { buildCommandRegistry, runEventHandlers } from "./core/moduleRuntime.js";
import { registerEvents } from "./events/registerEvents.js";
import { modules } from "./modules/index.js";

const logger = createLogger(env.logLevel);
const settingsStore = new SettingsStore(modules, logger);
const scheduler = new Scheduler(logger);
const { commandRegistry, commandPayload, commandToModule } = buildCommandRegistry(modules);

const client = new Client({
  // Bewusst ohne das privilegierte Intent GuildMembers: Mitglieder werden bei
  // Bedarf einzeln per REST nachgeladen, das reicht für Dashboard und Module.
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [
    Partials.Channel,
    Partials.GuildMember,
    Partials.Message,
    Partials.Reaction,
    Partials.User
  ]
});

client.botContext = {
  env,
  logger,
  modules,
  settingsStore,
  scheduler,
  commandRegistry,
  commandToModule,
  commandPayload
};

registerEvents(client);

let shuttingDown = false;

async function shutdown(exitCode, reason) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info("Bot wird heruntergefahren", { reason });

  scheduler.stopAll();

  const webServer = client.botContext.webServer;
  await new Promise((resolve) => {
    if (!webServer) {
      resolve();
      return;
    }

    webServer.close(() => resolve());
    setTimeout(resolve, 3000).unref?.();
  });

  await runEventHandlers(modules, "shutdown", { client }, logger);
  await client.destroy().catch(() => null);
  closeDb();

  process.exit(exitCode);
}

process.on("SIGINT", () => shutdown(0, "SIGINT"));
process.on("SIGTERM", () => shutdown(0, "SIGTERM"));

process.on("unhandledRejection", (error) => {
  logger.error("Unbehandelte Promise-Rejection", {
    error: String(error?.stack || error)
  });
});

process.on("uncaughtException", (error) => {
  logger.error("Unbehandelte Exception", {
    error: String(error?.stack || error)
  });
  shutdown(1, "uncaughtException");
});

client.login(env.discordToken).catch((error) => {
  logger.error("Bot konnte nicht gestartet werden", {
    error: String(error)
  });
  process.exit(1);
});
