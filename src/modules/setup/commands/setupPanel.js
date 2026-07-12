import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { canManageServer } from "../../../core/permissions.js";
import { postSetupPanel } from "../services/panel.js";

export const setupPanelCommand = {
  alwaysAvailable: true,
  data: new SlashCommandBuilder()
    .setName("setup-panel")
    .setDescription("Postet das Setup-Panel der modularen Basis."),

  async execute({ client, interaction }) {
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

    await interaction.deferReply({
      flags: MessageFlags.Ephemeral
    });

    try {
      await postSetupPanel(interaction.channel, client);

      await interaction.editReply({
        content: "Setup-Modulverwaltung wurde gepostet."
      });
    } catch {
      await interaction.editReply({
        content: "Setup-Modulverwaltung konnte nicht gepostet werden. Prüfe Bot-Rechte im Kanal."
      });
    }
  }
};
