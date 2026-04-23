import { MessageFlags, SlashCommandBuilder } from "discord.js";
import {
  ensureOnboardingChannels,
  ensureRulesMessage,
  getDefaultRulesText
} from "../features/onboarding/service.js";
import { canManageServer } from "../utils/permissions.js";

export const rulesSetCommand = {
  data: new SlashCommandBuilder()
    .setName("regeln-setzen")
    .setDescription("Aktualisiert das Regelwerk im Regeln-Channel.")
    .addStringOption((option) =>
      option
        .setName("text")
        .setDescription("Regeltext (max. 1800 Zeichen)")
        .setRequired(false)
        .setMaxLength(1800)
    ),

  async execute(interaction) {
    if (!canManageServer(interaction.member)) {
      await interaction.reply({
        content: "Diesen Befehl dürfen nur Admins oder Mitglieder mit Server-verwalten nutzen.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const { guildSettingsRepository, logger } = interaction.client.botContext;

    const providedText = interaction.options.getString("text", false);
    const rulesText = providedText || getDefaultRulesText();

    guildSettingsRepository.setField(interaction.guildId, "rules_text", rulesText);

    const settings = await ensureOnboardingChannels(interaction.guild, guildSettingsRepository, logger);
    await ensureRulesMessage(interaction.guild, settings, guildSettingsRepository, logger);

    await interaction.reply({
      content: "Regelwerk wurde aktualisiert und neu gepostet.",
      flags: MessageFlags.Ephemeral
    });
  }
};
