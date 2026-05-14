import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { canManageServer } from "../../../core/permissions.js";
import {
  createUniqueDepartmentId,
  ensureValidDefaultDepartmentId,
  extractRoleIds,
  normalizeDepartments
} from "../services/config.js";

function formatDepartmentLine(department, isDefault) {
  const roles = department.roleIds.length > 0
    ? department.roleIds.map((roleId) => `<@&${roleId}>`).join(" ")
    : "(keine Rollen)";

  return [
    `${isDefault ? "[Default] " : ""}${department.name} (${department.id})`,
    `Rollen: ${roles}`
  ].join("\n");
}

function sanitizeDepartmentInput(value) {
  return String(value || "")
    .trim()
    .replace(/\s*\(default\)\s*$/i, "")
    .trim();
}

function slugifyDepartmentInput(value) {
  const slug = sanitizeDepartmentInput(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);

  return slug || "department";
}

function resolveDepartmentInput(departments, input) {
  const normalizedDepartments = normalizeDepartments(departments);
  const directInput = String(input || "").trim();
  const cleanedInput = sanitizeDepartmentInput(directInput);
  const lowerInput = cleanedInput.toLowerCase();

  if (!cleanedInput) {
    return null;
  }

  const byId = normalizedDepartments.find((department) => department.id.toLowerCase() === lowerInput);
  if (byId) {
    return byId;
  }

  const byName = normalizedDepartments.find((department) => department.name.toLowerCase() === lowerInput);
  if (byName) {
    return byName;
  }

  const bySlug = normalizedDepartments.find((department) => department.id === slugifyDepartmentInput(cleanedInput));
  return bySlug || null;
}

export const supportDepartmentCommand = {
  data: new SlashCommandBuilder()
    .setName("support-department")
    .setDescription("Verwaltet Support-Departments und deren Rollen.")
    .addSubcommand((subcommand) => subcommand
      .setName("add")
      .setDescription("Erstellt ein neues Department.")
      .addStringOption((option) => option
        .setName("name")
        .setDescription("Name des Departments")
        .setRequired(true))
      .addStringOption((option) => option
        .setName("rollen")
        .setDescription("Rollen-IDs oder Erwähnungen, getrennt durch Leerzeichen/Komma")
        .setRequired(false)))
    .addSubcommand((subcommand) => subcommand
      .setName("remove")
      .setDescription("Entfernt ein Department.")
      .addStringOption((option) => option
        .setName("id")
        .setDescription("ID oder Name des Departments")
        .setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("set-default")
      .setDescription("Setzt das Standard-Department.")
      .addStringOption((option) => option
        .setName("id")
        .setDescription("ID oder Name des Departments")
        .setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("list")
      .setDescription("Zeigt alle Departments und Rollen.")),

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

    const { moduleConfigStore } = client.botContext;
    const supportState = moduleConfigStore.getModuleState(interaction.guildId, "support");

    if (!supportState) {
      await interaction.reply({
        content: "Support-Modul wurde nicht gefunden.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    const config = supportState.config || {};
    const departments = normalizeDepartments(config.departments);
    const defaultDepartmentId = ensureValidDefaultDepartmentId(departments, config.defaultDepartmentId);

    if (subcommand === "list") {
      if (departments.length === 0) {
        await interaction.reply({
          content: "Keine Departments vorhanden.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const lines = departments.map((department) => formatDepartmentLine(department, department.id === defaultDepartmentId));
      await interaction.reply({
        content: lines.join("\n\n"),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === "add") {
      const name = interaction.options.getString("name", true).trim();
      const rolesRaw = interaction.options.getString("rollen") || "";
      const roleIds = extractRoleIds(rolesRaw);

      const departmentId = createUniqueDepartmentId(departments, name);
      const updatedDepartments = [
        ...departments,
        { id: departmentId, name, roleIds }
      ];

      moduleConfigStore.setModuleConfig(interaction.guildId, "support", {
        departments: updatedDepartments,
        defaultDepartmentId: defaultDepartmentId || departmentId
      });

      await interaction.reply({
        content: `Department erstellt: ${name} (${departmentId})`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === "remove") {
      const departmentInput = interaction.options.getString("id", true).trim();
      const targetDepartment = resolveDepartmentInput(departments, departmentInput);

      if (!targetDepartment) {
        await interaction.reply({
          content: `Department nicht gefunden: ${departmentInput}`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const departmentId = targetDepartment.id;

      const updatedDepartments = departments.filter((department) => department.id !== departmentId);
      if (updatedDepartments.length === 0) {
        await interaction.reply({
          content: "Es muss mindestens ein Department bestehen bleiben.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const nextDefaultDepartmentId = ensureValidDefaultDepartmentId(updatedDepartments, defaultDepartmentId);
      moduleConfigStore.setModuleConfig(interaction.guildId, "support", {
        departments: updatedDepartments,
        defaultDepartmentId: nextDefaultDepartmentId
      });

      await interaction.reply({
        content: `Department entfernt: ${departmentId}`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === "set-default") {
      const departmentInput = interaction.options.getString("id", true).trim();
      const targetDepartment = resolveDepartmentInput(departments, departmentInput);

      if (!targetDepartment) {
        await interaction.reply({
          content: `Department nicht gefunden: ${departmentInput}`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const departmentId = targetDepartment.id;

      moduleConfigStore.setModuleConfig(interaction.guildId, "support", {
        departments,
        defaultDepartmentId: departmentId
      });

      await interaction.reply({
        content: `Standard-Department gesetzt: ${departmentId}`,
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
