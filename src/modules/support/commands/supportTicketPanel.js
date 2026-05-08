import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { canManageServer } from "../../../core/permissions.js";
import {
  ensureDefaultDepartment,
  ensureValidDefaultDepartmentId
} from "../services/config.js";
import { buildSupportTicketPanelPayload } from "../services/ticketPanel.js";

export const supportTicketPanelCommand = {
  data: new SlashCommandBuilder()
    .setName("support-ticket-panel")
    .setDescription("Postet ein Ticket-Panel mit Start-Button."),

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
        content: "Nur Admins oder Mitglieder mit Server-verwalten dürfen das Ticket-Panel posten.",
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

    const supportState = client.botContext.moduleConfigStore.getModuleState(interaction.guildId, "support");
    const currentConfig = supportState?.config || {};

    const departments = ensureDefaultDepartment(
      currentConfig.departments,
      client.botContext.env.supportDefaultDepartmentName,
      []
    );

    const defaultDepartmentId = ensureValidDefaultDepartmentId(departments, currentConfig.defaultDepartmentId);

    client.botContext.moduleConfigStore.setModuleConfig(interaction.guildId, "support", {
      ...currentConfig,
      departments,
      defaultDepartmentId
    });

    await interaction.channel.send(buildSupportTicketPanelPayload(departments));

    await interaction.reply({
      content: "Ticket-Panel wurde gepostet.",
      flags: MessageFlags.Ephemeral
    });
  }
};
