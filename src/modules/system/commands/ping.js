import { MessageFlags, SlashCommandBuilder } from "discord.js";

export const pingCommand = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Antwortet mit der aktuellen Bot-Latenz."),

  async execute({ client, interaction }) {
    const gatewayPing = Math.round(client.ws.ping);

    await interaction.reply({
      content: `Pong. Gateway-Ping: ${gatewayPing}ms`,
      flags: MessageFlags.Ephemeral
    });
  }
};
