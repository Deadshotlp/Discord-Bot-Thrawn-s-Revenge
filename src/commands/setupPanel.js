import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { postSetupPanels } from "../features/setup/panel.js";
import { canManageServer } from "../utils/permissions.js";

export const setupPanelCommand = {
  data: new SlashCommandBuilder()
    .setName("setup-panel")
    .setDescription("Postet die Bot-Setup-Panels im aktuellen Channel."),

  async execute(interaction) {
    if (!canManageServer(interaction.member)) {
      await interaction.reply({
        content: "Diesen Befehl dürfen nur Admins oder Mitglieder mit Server-verwalten nutzen.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (!interaction.channel || !interaction.channel.isTextBased()) {
      await interaction.reply({
        content: "Dieser Befehl funktioniert nur in textbasierten Kanälen.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await postSetupPanels(interaction.channel);

    await interaction.reply({
      content: "Setup-Panels wurden erfolgreich gepostet.",
      flags: MessageFlags.Ephemeral
    });
  }
};
