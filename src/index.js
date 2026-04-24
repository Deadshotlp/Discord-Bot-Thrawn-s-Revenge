import {
  Client,
  GatewayIntentBits,
  Partials
} from "discord.js";

import { env } from "./config/env.js";
import { ModuleConfigStore } from "./core/moduleConfigStore.js";
import { createLogger } from "./core/logger.js";
import { buildCommandRegistry } from "./core/moduleRuntime.js";
import { registerEvents } from "./events/registerEvents.js";
import { modules } from "./modules/index.js";

const logger = createLogger(env.logLevel);
const moduleConfigStore = new ModuleConfigStore(modules, logger);
const { commandRegistry, commandPayload, commandToModule } = buildCommandRegistry(modules);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages
  ],
  partials: [Partials.Channel, Partials.GuildMember, Partials.Message, Partials.User]
});

client.botContext = {
  env,
  logger,
  modules,
  moduleConfigStore,
  commandRegistry,
  commandToModule,
  commandPayload
};

registerEvents(client);

client.login(env.discordToken).catch((error) => {
  logger.error("Bot konnte nicht gestartet werden", {
    error: String(error)
  });
  process.exit(1);
});
