import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { canManageServer } from "../../../core/permissions.js";
import { postVerifyPanel, DEFAULT_VERIFY_RULES_TEXT } from "../services/panel.js";

export const verifyPanelCommand = {
  data: new SlashCommandBuilder()
    .setName("verify-panel")
    .setDescription("Postet das Verify-Panel im aktuellen Kanal."),

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

    const verifyState = interaction.inGuild()
      ? client.botContext.moduleConfigStore.getModuleState(interaction.guildId, "verify")
      : null;

    const rulesText = verifyState?.config?.rulesText || DEFAULT_VERIFY_RULES_TEXT;
    await postVerifyPanel(interaction.channel, rulesText);

    await interaction.reply({
      content: "Verify-Panel wurde gepostet.",
      flags: MessageFlags.Ephemeral
    });
  }
};
