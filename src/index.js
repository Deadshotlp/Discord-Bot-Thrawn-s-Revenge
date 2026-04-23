import {
  Client,
  Events,
  GatewayIntentBits,
  Partials
} from "discord.js";

import { env } from "./config/env.js";
import { initDatabase } from "./db/database.js";
import { handleGuildCreate } from "./events/guildCreate.js";
import { handleGuildMemberAdd } from "./events/guildMemberAdd.js";
import { handleGuildMemberRemove } from "./events/guildMemberRemove.js";
import { handleInteractionCreate } from "./events/interactionCreate.js";
import { handleMessageDelete } from "./events/messageDelete.js";
import { handleReady } from "./events/ready.js";
import { handleVoiceStateUpdate } from "./events/voiceStateUpdate.js";
import { GuildSettingsRepository } from "./repositories/guildSettingsRepository.js";
import { createLogger } from "./utils/logger.js";

const logger = createLogger(env.logLevel);

const db = initDatabase();
const guildSettingsRepository = new GuildSettingsRepository(db);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel, Partials.GuildMember, Partials.Message, Partials.User]
});

client.botContext = {
  env,
  logger,
  guildSettingsRepository
};

client.once(Events.ClientReady, () => {
  handleReady(client).catch((error) => {
    logger.error("Ready-Handler schlug fehl.", { error: String(error) });
  });
});

client.on(Events.GuildCreate, (guild) => {
  handleGuildCreate(guild).catch((error) => {
    logger.error("GuildCreate-Handler schlug fehl.", { guildId: guild.id, error: String(error) });
  });
});

client.on(Events.InteractionCreate, (interaction) => {
  handleInteractionCreate(interaction).catch((error) => {
    logger.error("InteractionCreate-Handler schlug fehl.", { error: String(error) });
  });
});

client.on(Events.GuildMemberAdd, (member) => {
  handleGuildMemberAdd(member).catch((error) => {
    logger.warn("GuildMemberAdd-Handler schlug fehl.", { guildId: member.guild.id, error: String(error) });
  });
});

client.on(Events.GuildMemberRemove, (member) => {
  handleGuildMemberRemove(member).catch((error) => {
    logger.warn("GuildMemberRemove-Handler schlug fehl.", { guildId: member.guild.id, error: String(error) });
  });
});

client.on(Events.MessageDelete, (message) => {
  handleMessageDelete(message).catch((error) => {
    logger.warn("MessageDelete-Handler schlug fehl.", { error: String(error) });
  });
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  handleVoiceStateUpdate(oldState, newState).catch((error) => {
    logger.warn("VoiceStateUpdate-Handler schlug fehl.", { error: String(error) });
  });
});

client.login(env.discordToken).catch((error) => {
  logger.error("Bot konnte nicht gestartet werden.", { error: String(error) });
  process.exit(1);
});
