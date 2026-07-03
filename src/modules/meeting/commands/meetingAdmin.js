import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { canManageServer } from "../../../core/permissions.js";
import { buildMeetingManagementPayload } from "../services/adminUi.js";
import { getMeetingModuleConfig } from "./meeting.js";

export const meetingAdminCommand = {
  data: new SlashCommandBuilder()
    .setName("meeting-admin")
    .setDescription("Meetings anlegen, bearbeiten und Themen verwalten."),

  async execute({ client, interaction }) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "Dieser Befehl funktioniert nur auf einem Server.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (!canManageServer(interaction.member)) {
      await interaction.reply({
        content: "Nur Admins oder Mitglieder mit Server-verwalten dürfen Meetings verwalten.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const { meetings } = getMeetingModuleConfig(client, interaction.guildId);
    await interaction.reply({
      ...buildMeetingManagementPayload(meetings),
      flags: MessageFlags.Ephemeral
    });
  }
};
