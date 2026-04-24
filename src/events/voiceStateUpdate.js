import { runEventHandlers } from "../core/moduleRuntime.js";

export async function handleVoiceStateUpdate(client, oldState, newState) {
  const { logger, modules } = client.botContext;

  await runEventHandlers(
    modules,
    "voiceStateUpdate",
    {
      client,
      guild: newState.guild || oldState.guild,
      oldState,
      newState
    },
    logger
  );
}
