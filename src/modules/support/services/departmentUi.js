import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";

export const SUPPORT_DEPT_UI_ADD_BUTTON_ID = "support_dept_ui_add";
export const SUPPORT_DEPT_UI_REFRESH_BUTTON_ID = "support_dept_ui_refresh";
export const SUPPORT_DEPT_UI_SELECT_ID = "support_dept_ui_select";

export const SUPPORT_DEPT_UI_SET_DEFAULT_PREFIX = "support_dept_ui_set_default:";
export const SUPPORT_DEPT_UI_SET_ROLES_PREFIX = "support_dept_ui_set_roles:";
export const SUPPORT_DEPT_UI_REMOVE_PREFIX = "support_dept_ui_remove:";

export const SUPPORT_DEPT_UI_ADD_MODAL_ID = "support_dept_ui_add_modal";
export const SUPPORT_DEPT_UI_ROLES_MODAL_PREFIX = "support_dept_ui_roles_modal:";

export const SUPPORT_DEPT_UI_ADD_NAME_INPUT_ID = "support_dept_ui_add_name";
export const SUPPORT_DEPT_UI_ADD_ROLES_INPUT_ID = "support_dept_ui_add_roles";
export const SUPPORT_DEPT_UI_ROLES_INPUT_ID = "support_dept_ui_roles";

function formatRoles(roleIds) {
  if (!Array.isArray(roleIds) || roleIds.length === 0) {
    return "(keine Rollen)";
  }

  return roleIds.map((roleId) => `<@&${roleId}>`).join(" ");
}

function buildDepartmentsList(departments, defaultDepartmentId) {
  const safeDepartments = Array.isArray(departments) ? departments : [];
  if (safeDepartments.length === 0) {
    return "Keine Departments vorhanden.";
  }

  return safeDepartments
    .map((department) => {
      const marker = department.id === defaultDepartmentId ? "[Default] " : "";
      return `${marker}${department.name} (${department.id})\nRollen: ${formatRoles(department.roleIds)}`;
    })
    .join("\n\n");
}

export function buildSupportDepartmentManagementPayload(departments, defaultDepartmentId) {
  const safeDepartments = Array.isArray(departments) ? departments : [];

  const embed = new EmbedBuilder()
    .setColor(0x1f6feb)
    .setTitle("Support Departments verwalten")
    .setDescription("Departments können hier direkt per Interface erstellt und bearbeitet werden.")
    .addFields({
      name: "Aktuelle Departments",
      value: buildDepartmentsList(safeDepartments, defaultDepartmentId)
    });

  const actionsRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(SUPPORT_DEPT_UI_ADD_BUTTON_ID)
      .setLabel("Department hinzufügen")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(SUPPORT_DEPT_UI_REFRESH_BUTTON_ID)
      .setLabel("Aktualisieren")
      .setStyle(ButtonStyle.Secondary)
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId(SUPPORT_DEPT_UI_SELECT_ID)
    .setPlaceholder("Department auswählen")
    .setMinValues(1)
    .setMaxValues(1);

  if (safeDepartments.length === 0) {
    select
      .setPlaceholder("Keine Departments vorhanden")
      .setDisabled(true)
      .addOptions([{ label: "Keine Departments", value: "none" }]);
  } else {
    select.addOptions(
      safeDepartments.slice(0, 25).map((department) => ({
        label: department.name.slice(0, 100),
        description: `ID: ${department.id}`.slice(0, 100),
        value: department.id
      }))
    );
  }

  return {
    embeds: [embed],
    components: [actionsRow, new ActionRowBuilder().addComponents(select)]
  };
}

export function buildSupportDepartmentActionsPayload(department, isDefault, canRemove) {
  const embed = new EmbedBuilder()
    .setColor(0x2ea043)
    .setTitle(`Department: ${department.name}`)
    .addFields(
      { name: "ID", value: department.id, inline: true },
      { name: "Default", value: isDefault ? "Ja" : "Nein", inline: true },
      { name: "Rollen", value: formatRoles(department.roleIds), inline: false }
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${SUPPORT_DEPT_UI_SET_DEFAULT_PREFIX}${department.id}`)
      .setLabel("Als Default setzen")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(isDefault),
    new ButtonBuilder()
      .setCustomId(`${SUPPORT_DEPT_UI_SET_ROLES_PREFIX}${department.id}`)
      .setLabel("Rollen setzen")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${SUPPORT_DEPT_UI_REMOVE_PREFIX}${department.id}`)
      .setLabel("Entfernen")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!canRemove)
  );

  return {
    embeds: [embed],
    components: [row]
  };
}

export function buildSupportDepartmentAddModal() {
  const modal = new ModalBuilder()
    .setCustomId(SUPPORT_DEPT_UI_ADD_MODAL_ID)
    .setTitle("Department hinzufügen");

  const nameInput = new TextInputBuilder()
    .setCustomId(SUPPORT_DEPT_UI_ADD_NAME_INPUT_ID)
    .setLabel("Department-Name")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(80)
    .setPlaceholder("z. B. Technik");

  const rolesInput = new TextInputBuilder()
    .setCustomId(SUPPORT_DEPT_UI_ADD_ROLES_INPUT_ID)
    .setLabel("Rollen (IDs oder Erwähnungen)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(400)
    .setPlaceholder("Optional, mehrere Rollen möglich");

  modal.addComponents(
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(rolesInput)
  );

  return modal;
}

export function buildSupportDepartmentRolesModal(department) {
  const modal = new ModalBuilder()
    .setCustomId(`${SUPPORT_DEPT_UI_ROLES_MODAL_PREFIX}${department.id}`)
    .setTitle(`Rollen: ${department.name}`.slice(0, 45));

  const rolesInput = new TextInputBuilder()
    .setCustomId(SUPPORT_DEPT_UI_ROLES_INPUT_ID)
    .setLabel("Rollen (IDs oder Erwähnungen)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(400)
    .setPlaceholder("Leer lassen = keine Rollen");

  if (Array.isArray(department.roleIds) && department.roleIds.length > 0) {
    rolesInput.setValue(department.roleIds.join(", ").slice(0, 400));
  }

  modal.addComponents(new ActionRowBuilder().addComponents(rolesInput));
  return modal;
}
