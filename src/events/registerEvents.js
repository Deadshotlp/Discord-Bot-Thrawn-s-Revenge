import { Events } from "discord.js";
import { handleGuildCreate } from "./guildCreate.js";
import { handleInteractionCreate } from "./interactionCreate.js";
import { handleReady } from "./ready.js";
import { handleVoiceStateUpdate } from "./voiceStateUpdate.js";

export function registerEvents(client) {
  client.once(Events.ClientReady, () => {
    handleReady(client).catch((error) => {
      client.botContext.logger.error("Ready-Handler fehlgeschlagen", {
        error: String(error)
      });
    });
  });

  client.on(Events.InteractionCreate, (interaction) => {
    handleInteractionCreate(client, interaction).catch((error) => {
      client.botContext.logger.warn("InteractionCreate-Handler fehlgeschlagen", {
        error: String(error)
      });
    });
  });

  client.on(Events.GuildCreate, (guild) => {
    handleGuildCreate(client, guild).catch((error) => {
      client.botContext.logger.warn("GuildCreate-Handler fehlgeschlagen", {
        guildId: guild.id,
        error: String(error)
      });
    });
  });

  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    handleVoiceStateUpdate(client, oldState, newState).catch((error) => {
      client.botContext.logger.warn("VoiceStateUpdate-Handler fehlgeschlagen", {
        guildId: newState.guild?.id || oldState.guild?.id,
        error: String(error)
      });
    });
  });
}
