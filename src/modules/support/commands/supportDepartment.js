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

function buildDepartmentChoices(departments, defaultDepartmentId, query) {
  const normalizedDepartments = normalizeDepartments(departments);
  const search = String(query || "").trim().toLowerCase();

  const filtered = normalizedDepartments.filter((department) => {
    if (!search) {
      return true;
    }

    return department.name.toLowerCase().includes(search) || department.id.toLowerCase().includes(search);
  });

  return filtered
    .slice(0, 25)
    .map((department) => ({
      name: `${department.name}${department.id === defaultDepartmentId ? " (default)" : ""} [${department.id}]`.slice(0, 100),
      value: department.id.slice(0, 100)
    }));
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
      .setName("add-role")
      .setDescription("Fügt Rollen zu einem Department hinzu.")
      .addStringOption((option) => option
        .setName("id")
        .setDescription("ID oder Name des Departments")
        .setRequired(true)
        .setAutocomplete(true))
      .addStringOption((option) => option
        .setName("rollen")
        .setDescription("Rollen-IDs oder Erwähnungen, getrennt durch Leerzeichen/Komma")
        .setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("remove-role")
      .setDescription("Entfernt Rollen aus einem Department.")
      .addStringOption((option) => option
        .setName("id")
        .setDescription("ID oder Name des Departments")
        .setRequired(true)
        .setAutocomplete(true))
      .addStringOption((option) => option
        .setName("rollen")
        .setDescription("Rollen-IDs oder Erwähnungen, getrennt durch Leerzeichen/Komma")
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

  async autocomplete({ client, interaction }) {
    if (!interaction.inGuild()) {
      await interaction.respond([]);
      return;
    }

    const subcommand = interaction.options.getSubcommand(false);
    const focused = interaction.options.getFocused(true);

    if (!focused || focused.name !== "id" || !["add-role", "remove-role"].includes(subcommand)) {
      await interaction.respond([]);
      return;
    }

    const supportState = client.botContext.moduleConfigStore.getModuleState(interaction.guildId, "support");
    const config = supportState?.config || {};
    const departments = normalizeDepartments(config.departments);
    const defaultDepartmentId = ensureValidDefaultDepartmentId(departments, config.defaultDepartmentId);
    const choices = buildDepartmentChoices(departments, defaultDepartmentId, focused.value);

    await interaction.respond(choices);
  },

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

    if (subcommand === "add-role") {
      const departmentInput = interaction.options.getString("id", true).trim();
      const roleInput = interaction.options.getString("rollen", true);
      const roleIds = extractRoleIds(roleInput);

      if (roleIds.length === 0) {
        await interaction.reply({
          content: "Keine gültigen Rollen-IDs gefunden.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const targetDepartment = resolveDepartmentInput(departments, departmentInput);
      if (!targetDepartment) {
        await interaction.reply({
          content: `Department nicht gefunden: ${departmentInput}`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const departmentId = targetDepartment.id;

      const mergedRoleIds = [...new Set([...(targetDepartment.roleIds || []), ...roleIds])];
      const updatedDepartments = departments.map((department) => {
        if (department.id !== departmentId) {
          return department;
        }

        return {
          ...department,
          roleIds: mergedRoleIds
        };
      });

      moduleConfigStore.setModuleConfig(interaction.guildId, "support", {
        departments: updatedDepartments,
        defaultDepartmentId
      });

      await interaction.reply({
        content: [
          `Rollen zu Department ${targetDepartment.name} (${departmentId}) hinzugefügt.`,
          `Aktuelle Rollen: ${mergedRoleIds.map((roleId) => `<@&${roleId}>`).join(" ")}`
        ].join("\n"),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === "remove-role") {
      const departmentInput = interaction.options.getString("id", true).trim();
      const roleInput = interaction.options.getString("rollen", true);
      const roleIds = extractRoleIds(roleInput);

      if (roleIds.length === 0) {
        await interaction.reply({
          content: "Keine gültigen Rollen-IDs gefunden.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const targetDepartment = resolveDepartmentInput(departments, departmentInput);
      if (!targetDepartment) {
        await interaction.reply({
          content: `Department nicht gefunden: ${departmentInput}`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const departmentId = targetDepartment.id;
      const currentRoleIds = Array.isArray(targetDepartment.roleIds) ? targetDepartment.roleIds : [];
      const nextRoleIds = currentRoleIds.filter((roleId) => !roleIds.includes(roleId));

      if (nextRoleIds.length === currentRoleIds.length) {
        await interaction.reply({
          content: "Keine der angegebenen Rollen war in diesem Department hinterlegt.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const removedRoleIds = currentRoleIds.filter((roleId) => roleIds.includes(roleId));
      const updatedDepartments = departments.map((department) => {
        if (department.id !== departmentId) {
          return department;
        }

        return {
          ...department,
          roleIds: nextRoleIds
        };
      });

      moduleConfigStore.setModuleConfig(interaction.guildId, "support", {
        departments: updatedDepartments,
        defaultDepartmentId
      });

      const currentMentions = nextRoleIds.length > 0
        ? nextRoleIds.map((roleId) => `<@&${roleId}>`).join(" ")
        : "(keine Rollen)";

      await interaction.reply({
        content: [
          `Rollen aus Department ${targetDepartment.name} (${departmentId}) entfernt.`,
          `Entfernt: ${removedRoleIds.map((roleId) => `<@&${roleId}>`).join(" ")}`,
          `Aktuelle Rollen: ${currentMentions}`
        ].join("\n"),
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
