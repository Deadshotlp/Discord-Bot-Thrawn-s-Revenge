import { runEventHandlers } from "../core/moduleRuntime.js";

export async function handleReady(client) {
  const { logger, commandPayload, modules } = client.botContext;

  logger.info(`Bot ist online als ${client.user.tag}`);

  try {
    const globalCommands = await client.application.commands.fetch();
    if (globalCommands.size > 0) {
      await client.application.commands.set([]);
      logger.info("Globale Slash-Commands wurden geleert", {
        removed: globalCommands.size
      });
    }
  } catch (error) {
    logger.warn("Globale Slash-Commands konnten nicht geleert werden", {
      error: String(error)
    });
  }

  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.commands.set(commandPayload);
      logger.info("Guild-Commands registriert", {
        guildId: guild.id,
        count: commandPayload.length
      });
    } catch (error) {
      logger.warn("Guild-Commands konnten nicht registriert werden", {
        guildId: guild.id,
        error: String(error)
      });
    }
  }

  await runEventHandlers(modules, "ready", { client }, logger);
}
