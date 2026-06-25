import { MessageFlags } from "discord.js";
import { canManageServer } from "../../../core/permissions.js";
import {
  createUniqueDepartmentId,
  ensureDefaultDepartment,
  ensureValidDefaultDepartmentId,
  extractRoleIds,
  getDepartmentById
} from "../services/config.js";
import {
  SUPPORT_DEPT_UI_ADD_BUTTON_ID,
  SUPPORT_DEPT_UI_ADD_MODAL_ID,
  SUPPORT_DEPT_UI_ADD_NAME_INPUT_ID,
  SUPPORT_DEPT_UI_ADD_ROLES_INPUT_ID,
  SUPPORT_DEPT_UI_REFRESH_BUTTON_ID,
  SUPPORT_DEPT_UI_REMOVE_PREFIX,
  SUPPORT_DEPT_UI_ROLES_INPUT_ID,
  SUPPORT_DEPT_UI_ROLES_MODAL_PREFIX,
  SUPPORT_DEPT_UI_SELECT_ID,
  SUPPORT_DEPT_UI_SET_DEFAULT_PREFIX,
  SUPPORT_DEPT_UI_SET_ROLES_PREFIX,
  buildSupportDepartmentActionsPayload,
  buildSupportDepartmentAddModal,
  buildSupportDepartmentManagementPayload,
  buildSupportDepartmentRolesModal
} from "../services/departmentUi.js";

function updateSupportDepartments(moduleConfigStore, guildId, currentConfig, departments, defaultDepartmentId) {
  moduleConfigStore.setModuleConfig(guildId, "support", {
    ...currentConfig,
    departments,
    defaultDepartmentId
  });
}

export async function handleDepartmentUiInteraction({ client, interaction }) {
  if (!interaction.inGuild()) {
    return false;
  }

  const isDepartmentButton = interaction.isButton() && (
    interaction.customId === SUPPORT_DEPT_UI_ADD_BUTTON_ID
    || interaction.customId === SUPPORT_DEPT_UI_REFRESH_BUTTON_ID
    || interaction.customId.startsWith(SUPPORT_DEPT_UI_SET_DEFAULT_PREFIX)
    || interaction.customId.startsWith(SUPPORT_DEPT_UI_SET_ROLES_PREFIX)
    || interaction.customId.startsWith(SUPPORT_DEPT_UI_REMOVE_PREFIX)
  );

  const isDepartmentSelect = interaction.isStringSelectMenu() && interaction.customId === SUPPORT_DEPT_UI_SELECT_ID;
  const isDepartmentModal = interaction.isModalSubmit() && (
    interaction.customId === SUPPORT_DEPT_UI_ADD_MODAL_ID
    || interaction.customId.startsWith(SUPPORT_DEPT_UI_ROLES_MODAL_PREFIX)
  );

  if (!isDepartmentButton && !isDepartmentSelect && !isDepartmentModal) {
    return false;
  }

  if (!canManageServer(interaction.member)) {
    await interaction.reply({
      content: "Nur Admins oder Mitglieder mit Server-verwalten dürfen Departments verwalten.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const { moduleConfigStore, env } = client.botContext;
  const supportState = moduleConfigStore.getModuleState(interaction.guildId, "support");
  const currentConfig = supportState?.config || {};

  const departments = ensureDefaultDepartment(
    currentConfig.departments,
    env.supportDefaultDepartmentName,
    []
  );

  const defaultDepartmentId = ensureValidDefaultDepartmentId(departments, currentConfig.defaultDepartmentId);

  if (interaction.isButton() && interaction.customId === SUPPORT_DEPT_UI_REFRESH_BUTTON_ID) {
    await interaction.update(buildSupportDepartmentManagementPayload(departments, defaultDepartmentId));
    return true;
  }

  if (interaction.isButton() && interaction.customId === SUPPORT_DEPT_UI_ADD_BUTTON_ID) {
    await interaction.showModal(buildSupportDepartmentAddModal());
    return true;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === SUPPORT_DEPT_UI_SELECT_ID) {
    const selectedDepartmentId = interaction.values?.[0] || "";
    const selectedDepartment = getDepartmentById(departments, selectedDepartmentId);
    if (!selectedDepartment) {
      await interaction.reply({
        content: "Department nicht gefunden.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    await interaction.reply({
      ...buildSupportDepartmentActionsPayload(
        selectedDepartment,
        selectedDepartment.id === defaultDepartmentId,
        departments.length > 1
      ),
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(SUPPORT_DEPT_UI_SET_DEFAULT_PREFIX)) {
    const departmentId = interaction.customId.slice(SUPPORT_DEPT_UI_SET_DEFAULT_PREFIX.length);
    const selectedDepartment = getDepartmentById(departments, departmentId);
    if (!selectedDepartment) {
      await interaction.reply({
        content: "Department nicht gefunden.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    updateSupportDepartments(moduleConfigStore, interaction.guildId, currentConfig, departments, departmentId);
    await interaction.update(buildSupportDepartmentActionsPayload(selectedDepartment, true, departments.length > 1));
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(SUPPORT_DEPT_UI_SET_ROLES_PREFIX)) {
    const departmentId = interaction.customId.slice(SUPPORT_DEPT_UI_SET_ROLES_PREFIX.length);
    const selectedDepartment = getDepartmentById(departments, departmentId);
    if (!selectedDepartment) {
      await interaction.reply({
        content: "Department nicht gefunden.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    await interaction.showModal(buildSupportDepartmentRolesModal(selectedDepartment));
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(SUPPORT_DEPT_UI_REMOVE_PREFIX)) {
    const departmentId = interaction.customId.slice(SUPPORT_DEPT_UI_REMOVE_PREFIX.length);
    if (departments.length <= 1) {
      await interaction.reply({
        content: "Es muss mindestens ein Department bestehen bleiben.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const updatedDepartments = departments.filter((department) => department.id !== departmentId);
    if (updatedDepartments.length === departments.length) {
      await interaction.reply({
        content: "Department nicht gefunden.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const nextDefaultDepartmentId = ensureValidDefaultDepartmentId(updatedDepartments, defaultDepartmentId);
    updateSupportDepartments(
      moduleConfigStore,
      interaction.guildId,
      currentConfig,
      updatedDepartments,
      nextDefaultDepartmentId
    );

    await interaction.update({
      content: `Department ${departmentId} wurde entfernt.`,
      embeds: [],
      components: []
    });
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId === SUPPORT_DEPT_UI_ADD_MODAL_ID) {
    const departmentName = interaction.fields.getTextInputValue(SUPPORT_DEPT_UI_ADD_NAME_INPUT_ID)?.trim() || "";
    const rolesRaw = interaction.fields.getTextInputValue(SUPPORT_DEPT_UI_ADD_ROLES_INPUT_ID) || "";

    if (!departmentName) {
      await interaction.reply({
        content: "Department-Name darf nicht leer sein.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const departmentId = createUniqueDepartmentId(departments, departmentName);
    const roleIds = extractRoleIds(rolesRaw);
    const updatedDepartments = [
      ...departments,
      {
        id: departmentId,
        name: departmentName,
        roleIds
      }
    ];

    const nextDefaultDepartmentId = ensureValidDefaultDepartmentId(updatedDepartments, defaultDepartmentId || departmentId);
    updateSupportDepartments(
      moduleConfigStore,
      interaction.guildId,
      currentConfig,
      updatedDepartments,
      nextDefaultDepartmentId
    );

    await interaction.reply({
      content: `Department erstellt: ${departmentName} (${departmentId})`,
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith(SUPPORT_DEPT_UI_ROLES_MODAL_PREFIX)) {
    const departmentId = interaction.customId.slice(SUPPORT_DEPT_UI_ROLES_MODAL_PREFIX.length);
    const selectedDepartment = getDepartmentById(departments, departmentId);
    if (!selectedDepartment) {
      await interaction.reply({
        content: "Department nicht gefunden.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const rolesRaw = interaction.fields.getTextInputValue(SUPPORT_DEPT_UI_ROLES_INPUT_ID) || "";
    const roleIds = extractRoleIds(rolesRaw);

    const updatedDepartments = departments.map((department) => {
      if (department.id !== departmentId) {
        return department;
      }

      return {
        ...department,
        roleIds
      };
    });

    updateSupportDepartments(moduleConfigStore, interaction.guildId, currentConfig, updatedDepartments, defaultDepartmentId);

    await interaction.reply({
      content: `Rollen für ${selectedDepartment.name} wurden aktualisiert.`,
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  return false;
}
