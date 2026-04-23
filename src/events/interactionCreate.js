import { MessageFlags } from "discord.js";
import { runEventHandlers } from "../core/moduleRuntime.js";

export async function handleInteractionCreate(client, interaction) {
  const { logger, modules, commandRegistry } = client.botContext;

  if (interaction.isChatInputCommand()) {
    const command = commandRegistry.get(interaction.commandName);

    if (!command) {
      await interaction.reply({
        content: "Unbekannter Befehl.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    try {
      await command.execute({ client, interaction, logger, env: client.botContext.env });
    } catch (error) {
      logger.warn("Slash-Command fehlgeschlagen", {
        command: interaction.commandName,
        error: String(error)
      });

      if (!interaction.deferred && !interaction.replied) {
        await interaction.reply({
          content: "Beim Ausführen des Befehls ist ein Fehler aufgetreten.",
          flags: MessageFlags.Ephemeral
        });
      }
    }

    return;
  }

  await runEventHandlers(modules, "interactionCreate", { client, interaction }, logger);
}
