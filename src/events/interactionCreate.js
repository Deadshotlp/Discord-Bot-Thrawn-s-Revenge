import { MessageFlags } from "discord.js";
import { buildCommandRegistry } from "../core/moduleRuntime.js";
import { runEventHandlers } from "../core/moduleRuntime.js";

export async function handleInteractionCreate(client, interaction) {
  const {
    logger,
    modules,
    commandRegistry,
    commandToModule,
    moduleConfigStore
  } = client.botContext;

  if (interaction.isAutocomplete()) {
    const command = commandRegistry.get(interaction.commandName);
    const moduleName = commandToModule.get(interaction.commandName);

    if (!command?.autocomplete) {
      await interaction.respond([]).catch(() => null);
      return;
    }

    if (
      interaction.inGuild()
      && moduleName
      && moduleName !== "setup"
      && !command.alwaysAvailable
      && !moduleConfigStore.isModuleEnabled(interaction.guildId, moduleName)
    ) {
      await interaction.respond([]).catch(() => null);
      return;
    }

    try {
      await command.autocomplete({ client, interaction, logger, env: client.botContext.env });
    } catch (error) {
      logger.warn("Autocomplete fehlgeschlagen", {
        command: interaction.commandName,
        error: String(error)
      });

      if (!interaction.responded) {
        await interaction.respond([]).catch(() => null);
      }
    }

    return;
  }

  if (interaction.isChatInputCommand()) {
    let command = commandRegistry.get(interaction.commandName);
    let moduleName = commandToModule.get(interaction.commandName);

    if (!command) {
      const rebuilt = buildCommandRegistry(modules);
      client.botContext.commandRegistry = rebuilt.commandRegistry;
      client.botContext.commandPayload = rebuilt.commandPayload;
      client.botContext.commandToModule = rebuilt.commandToModule;

      command = rebuilt.commandRegistry.get(interaction.commandName);
      moduleName = rebuilt.commandToModule.get(interaction.commandName);
    }

    if (!command) {
      await interaction.reply({
        content: "Unbekannter Befehl.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (
      interaction.inGuild()
      && moduleName
      && moduleName !== "setup"
      && !command.alwaysAvailable
      && !moduleConfigStore.isModuleEnabled(interaction.guildId, moduleName)
    ) {
      await interaction.reply({
        content: `Das Modul ${moduleName} ist aktuell deaktiviert.`,
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

      const apiCode = error?.code;
      if (apiCode === 10062 || apiCode === 40060) {
        return;
      }

      if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({
          content: "Beim Ausführen des Befehls ist ein Fehler aufgetreten."
        }).catch(() => null);
      } else if (!interaction.deferred && !interaction.replied) {
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
