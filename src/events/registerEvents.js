import { Events } from "discord.js";
import { handleGuildCreate } from "./guildCreate.js";
import {
  handleGuildMemberAdd,
  handleGuildMemberRemove,
  handleGuildMemberUpdate
} from "./guildMemberUpdate.js";
import { handleInteractionCreate } from "./interactionCreate.js";
import { handleMessageReactionAdd } from "./messageReactionAdd.js";
import { handleReady } from "./ready.js";
import { handleVoiceStateUpdate } from "./voiceStateUpdate.js";

function registerMemberEvents(client) {
  // Diese Ereignisse liefert Discord nur mit dem privilegierten Intent. Ist es
  // aus, bleiben die Handler ungebunden statt still ins Leere zu laufen.
  if (!client.botContext.env.guildMembersIntent) {
    return;
  }

  client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
    handleGuildMemberUpdate(client, oldMember, newMember).catch((error) => {
      client.botContext.logger.warn("GuildMemberUpdate-Handler fehlgeschlagen", {
        guildId: newMember?.guild?.id || null,
        error: String(error)
      });
    });
  });

  client.on(Events.GuildMemberAdd, (member) => {
    handleGuildMemberAdd(client, member).catch((error) => {
      client.botContext.logger.warn("GuildMemberAdd-Handler fehlgeschlagen", {
        guildId: member?.guild?.id || null,
        error: String(error)
      });
    });
  });

  client.on(Events.GuildMemberRemove, (member) => {
    handleGuildMemberRemove(client, member).catch((error) => {
      client.botContext.logger.warn("GuildMemberRemove-Handler fehlgeschlagen", {
        guildId: member?.guild?.id || null,
        error: String(error)
      });
    });
  });
}

export function registerEvents(client) {
  registerMemberEvents(client);

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

  client.on(Events.MessageReactionAdd, (reaction, user) => {
    handleMessageReactionAdd(client, reaction, user).catch((error) => {
      client.botContext.logger.warn("MessageReactionAdd-Handler fehlgeschlagen", {
        guildId: reaction?.message?.guild?.id || null,
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
