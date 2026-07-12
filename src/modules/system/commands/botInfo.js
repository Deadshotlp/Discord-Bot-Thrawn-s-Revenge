import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { canManageServer } from "../../../core/permissions.js";

export const botInfoCommand = {
  data: new SlashCommandBuilder()
    .setName("bot-info")
    .setDescription("Zeigt Informationen zur modularen Basisstruktur."),

  async execute({ client, interaction }) {
    if (!canManageServer(interaction.member)) {
      await interaction.reply({
        content: "Diesen Befehl dürfen nur Admins oder Mitglieder mit Server-verwalten nutzen.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const {
      modules,
      commandRegistry,
      moduleConfigStore
    } = client.botContext;

    const guildConfig = interaction.inGuild()
      ? moduleConfigStore.getGuildConfig(interaction.guildId)
      : null;

    const moduleStateText = guildConfig
      ? Object.entries(guildConfig.modules)
        .map(([moduleName, state]) => `${moduleName}: ${state.enabled ? "an" : "aus"}`)
        .join(", ")
      : "(kein Guild-Kontext)";

    await interaction.reply({
      content: [
        "Modulare Basisstruktur aktiv.",
        `Module: ${modules.map((moduleDef) => moduleDef.name).join(", ")}`,
        `Slash-Commands: ${commandRegistry.size}`,
        `Modulstatus: ${moduleStateText}`
      ].join("\n"),
      flags: MessageFlags.Ephemeral
    });
  }
};
