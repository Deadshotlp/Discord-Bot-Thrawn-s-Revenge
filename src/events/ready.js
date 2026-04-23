import { commands } from "../commands/index.js";
import { bootstrapSetupForGuild } from "./guildCreate.js";

export async function handleReady(client) {
  const { logger, guildSettingsRepository } = client.botContext;
  const commandPayload = commands.map((command) => command.data.toJSON());

  logger.info(`Bot ist online als ${client.user.tag}.`);

  try {
    const globalCommands = await client.application.commands.fetch();
    if (globalCommands.size > 0) {
      await client.application.commands.set([]);
      logger.info("Alte globale Slash-Commands entfernt.", {
        removedCount: globalCommands.size
      });
    }
  } catch (error) {
    logger.warn("Globale Slash-Commands konnten nicht entfernt werden.", {
      error: String(error)
    });
  }

  for (const guild of client.guilds.cache.values()) {
    guildSettingsRepository.ensureGuild(guild.id);

    try {
      await guild.commands.set(commandPayload);
      logger.info("Slash-Commands fuer Guild registriert.", {
        guildId: guild.id,
        commandCount: commandPayload.length
      });
    } catch (error) {
      logger.warn("Slash-Commands konnten fuer Guild nicht registriert werden.", {
        guildId: guild.id,
        error: String(error)
      });
    }

    await bootstrapSetupForGuild(guild, {
      forcePostPanels: false,
      source: "ready-reconcile"
    });
  }

  logger.info(`Guild-Konfigurationen geprueft: ${client.guilds.cache.size}`);
}
