import { runEventHandlers } from "../core/moduleRuntime.js";

export async function handleMessageReactionAdd(client, reaction, user) {
  const { logger, modules } = client.botContext;

  await runEventHandlers(
    modules,
    "messageReactionAdd",
    {
      client,
      guild: reaction?.message?.guild || null,
      reaction,
      user
    },
    logger
  );
}
