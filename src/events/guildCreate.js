import { runEventHandlers } from "../core/moduleRuntime.js";

export async function handleGuildCreate(client, guild) {
  const { logger, modules } = client.botContext;

  logger.info("Bot ist neuem Server beigetreten", {
    guildId: guild.id,
    guildName: guild.name
  });

  await runEventHandlers(modules, "guildCreate", { client, guild }, logger);
}
