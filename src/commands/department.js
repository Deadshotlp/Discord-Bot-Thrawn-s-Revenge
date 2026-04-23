import { MessageFlags, SlashCommandBuilder } from "discord.js";
import {
  addRoleToDepartment,
  createDepartment,
  deleteDepartment,
  formatDepartmentList,
  getDepartmentsFromSettings,
  removeRoleFromDepartment
} from "../features/departments/service.js";
import { canManageServer } from "../utils/permissions.js";

export const departmentCommand = {
  data: new SlashCommandBuilder()
    .setName("department")
    .setDescription("Departments fuer Tickets verwalten")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("create")
        .setDescription("Erstellt ein neues Department")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("Anzeigename des Departments")
            .setRequired(true)
            .setMaxLength(50)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("delete")
        .setDescription("Loescht ein Department")
        .addStringOption((option) =>
          option
            .setName("department")
            .setDescription("Department-Name oder Department-ID")
            .setRequired(true)
            .setMaxLength(80)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("role-add")
        .setDescription("Fuegt einem Department eine Rolle hinzu")
        .addStringOption((option) =>
          option
            .setName("department")
            .setDescription("Department-Name oder Department-ID")
            .setRequired(true)
            .setMaxLength(80)
        )
        .addRoleOption((option) =>
          option
            .setName("rolle")
            .setDescription("Rolle, die dem Department zugewiesen werden soll")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("role-remove")
        .setDescription("Entfernt eine Rolle aus einem Department")
        .addStringOption((option) =>
          option
            .setName("department")
            .setDescription("Department-Name oder Department-ID")
            .setRequired(true)
            .setMaxLength(80)
        )
        .addRoleOption((option) =>
          option
            .setName("rolle")
            .setDescription("Rolle, die entfernt werden soll")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("Zeigt alle konfigurierten Departments")
    ),

  async execute(interaction) {
    if (!canManageServer(interaction.member)) {
      await interaction.reply({
        content: "Diesen Befehl duerfen nur Admins oder Mitglieder mit Server-verwalten nutzen.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const { guildSettingsRepository } = interaction.client.botContext;

    guildSettingsRepository.ensureGuild(interaction.guildId);
    let settings = guildSettingsRepository.getByGuildId(interaction.guildId) || {};

    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === "create") {
        const name = interaction.options.getString("name", true);
        createDepartment(guildSettingsRepository, interaction.guildId, settings, name);
      } else if (subcommand === "delete") {
        const query = interaction.options.getString("department", true);
        deleteDepartment(guildSettingsRepository, interaction.guildId, settings, query);
      } else if (subcommand === "role-add") {
        const query = interaction.options.getString("department", true);
        const role = interaction.options.getRole("rolle", true);
        addRoleToDepartment(guildSettingsRepository, interaction.guildId, settings, query, role.id);
      } else if (subcommand === "role-remove") {
        const query = interaction.options.getString("department", true);
        const role = interaction.options.getRole("rolle", true);
        removeRoleFromDepartment(guildSettingsRepository, interaction.guildId, settings, query, role.id);
      }

      settings = guildSettingsRepository.getByGuildId(interaction.guildId) || {};
      const departments = getDepartmentsFromSettings(settings);
      const header = subcommand === "list"
        ? "Aktuelle Department-Konfiguration:"
        : "Department-Konfiguration aktualisiert.";

      await interaction.reply({
        content: [
          header,
          "",
          formatDepartmentList(departments)
        ].join("\n"),
        flags: MessageFlags.Ephemeral
      });
    } catch (error) {
      await interaction.reply({
        content: `Department-Aktion fehlgeschlagen: ${String(error.message || error)}`,
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
