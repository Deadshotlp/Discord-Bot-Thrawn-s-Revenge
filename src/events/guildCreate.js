import { runEventHandlers } from "../core/moduleRuntime.js";

export async function handleGuildCreate(client, guild) {
  const {
    logger,
    modules,
    commandPayload,
    moduleConfigStore
  } = client.botContext;

  logger.info("Bot ist neuem Server beigetreten", {
    guildId: guild.id,
    guildName: guild.name
  });

  moduleConfigStore.ensureGuild(guild.id);

  try {
    await guild.commands.set(commandPayload);
    logger.info("Guild-Commands registriert (GuildCreate)", {
      guildId: guild.id,
      count: commandPayload.length
    });
  } catch (error) {
    logger.warn("Guild-Commands konnten bei GuildCreate nicht registriert werden", {
      guildId: guild.id,
      error: String(error)
    });
  }

  await runEventHandlers(modules, "guildCreate", { client, guild }, logger);
}
