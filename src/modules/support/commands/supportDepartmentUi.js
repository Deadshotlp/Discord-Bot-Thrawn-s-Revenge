import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { canManageServer } from "../../../core/permissions.js";
import {
  ensureDefaultDepartment,
  ensureValidDefaultDepartmentId
} from "../services/config.js";
import { buildSupportDepartmentManagementPayload } from "../services/departmentUi.js";

export const supportDepartmentUiCommand = {
  data: new SlashCommandBuilder()
    .setName("support-department-ui")
    .setDescription("Postet ein Interface zur Department-Verwaltung."),

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
        content: "Nur Admins oder Mitglieder mit Server-verwalten dürfen Departments verwalten.",
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

    await interaction.channel.send(buildSupportDepartmentManagementPayload(departments, defaultDepartmentId));

    await interaction.reply({
      content: "Department-Interface wurde gepostet.",
      flags: MessageFlags.Ephemeral
    });
  }
};
