import { MessageFlags, SlashCommandBuilder } from "discord.js";

export const botInfoCommand = {
  data: new SlashCommandBuilder()
    .setName("bot-info")
    .setDescription("Zeigt Informationen zur modularen Basisstruktur."),

  async execute({ client, interaction }) {
    const { modules, commandRegistry } = client.botContext;

    await interaction.reply({
      content: [
        "Modulare Basisstruktur aktiv.",
        `Module: ${modules.map((moduleDef) => moduleDef.name).join(", ")}`,
        `Slash-Commands: ${commandRegistry.size}`
      ].join("\n"),
      flags: MessageFlags.Ephemeral
    });
  }
};
