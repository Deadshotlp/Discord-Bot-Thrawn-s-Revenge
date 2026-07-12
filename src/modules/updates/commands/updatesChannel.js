import { ChannelType, MessageFlags, SlashCommandBuilder } from "discord.js";
import { canManageServer } from "../../../core/permissions.js";

export const updatesChannelCommand = {
  data: new SlashCommandBuilder()
    .setName("updates-channel")
    .setDescription("Legt den Kanal für automatische Repo-Updates und Changelogs fest.")
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Textkanal für Update-Posts")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)
    ),

  async execute({ client, interaction }) {
    if (!canManageServer(interaction.member)) {
      await interaction.reply({
        content: "Diesen Befehl dürfen nur Admins oder Mitglieder mit Server-verwalten nutzen.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const channel = interaction.options.getChannel("channel");
    const { moduleConfigStore } = client.botContext;
    const state = moduleConfigStore.getModuleState(interaction.guildId, "updates");

    moduleConfigStore.setModuleConfig(interaction.guildId, "updates", {
      ...(state?.config || {}),
      channelId: channel.id
    });

    await interaction.reply({
      content: `Updates und Changelogs werden künftig in <#${channel.id}> gepostet.`,
      flags: MessageFlags.Ephemeral
    });
  }
};
