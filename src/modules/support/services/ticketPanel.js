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

export const SUPPORT_TICKET_OPEN_BUTTON_ID = "support_ticket_open_button";
export const SUPPORT_TICKET_DEPARTMENT_SELECT_ID = "support_ticket_department_select";
export const SUPPORT_TICKET_OPEN_MODAL_PREFIX = "support_ticket_open_modal:";
export const SUPPORT_TICKET_CLOSE_PREFIX = "support_ticket_close:";
export const SUPPORT_TICKET_ESCALATE_PREFIX = "support_ticket_escalate:";
export const SUPPORT_TICKET_ESCALATE_SELECT_PREFIX = "support_ticket_escalate_select:";

export const SUPPORT_TICKET_NAME_INPUT_ID = "support_ticket_name";
export const SUPPORT_TICKET_DESCRIPTION_INPUT_ID = "support_ticket_description";

export const SUPPORT_TICKET_NAME_MAX_LENGTH = 80;
export const SUPPORT_TICKET_DESCRIPTION_MAX_LENGTH = 1200;

export function buildSupportTicketPanelPayload(departments) {
  const safeDepartments = Array.isArray(departments) ? departments : [];

  const departmentLines = safeDepartments.length > 0
    ? safeDepartments.map((department) => `- ${department.name} (${department.id})`).join("\n")
    : "- Keine Departments konfiguriert";

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle("Support Ticket erstellen")
    .setDescription(
      [
        "Klicke auf den Button, um ein Ticket zu erstellen.",
        "Danach wählst du das Department im Dropdown.",
        "Im Formular gibst du Ticket-Name und Beschreibung an.",
        "",
        "Verfügbare Departments:",
        departmentLines
      ].join("\n")
    );

  const button = new ButtonBuilder()
    .setCustomId(SUPPORT_TICKET_OPEN_BUTTON_ID)
    .setLabel("Ticket erstellen")
    .setStyle(ButtonStyle.Primary)
    .setDisabled(safeDepartments.length === 0);

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(button)]
  };
}

export function buildSupportTicketDepartmentSelectPayload(departments) {
  const safeDepartments = Array.isArray(departments) ? departments : [];
  const options = safeDepartments
    .slice(0, 25)
    .map((department) => ({
      label: department.name.slice(0, 100),
      value: department.id,
      description: `ID: ${department.id}`.slice(0, 100)
    }));

  const select = new StringSelectMenuBuilder()
    .setCustomId(SUPPORT_TICKET_DEPARTMENT_SELECT_ID)
    .setPlaceholder("Department auswählen")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  return {
    content: "Bitte wähle das Department für dein Ticket:",
    components: [new ActionRowBuilder().addComponents(select)]
  };
}

export function buildSupportTicketOpenModal(departmentId, departmentName = "") {
  const modal = new ModalBuilder()
    .setCustomId(`${SUPPORT_TICKET_OPEN_MODAL_PREFIX}${departmentId}`)
    .setTitle(`Ticket: ${departmentName || departmentId}`.slice(0, 45));

  const nameInput = new TextInputBuilder()
    .setCustomId(SUPPORT_TICKET_NAME_INPUT_ID)
    .setLabel("Ticket-Name")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(SUPPORT_TICKET_NAME_MAX_LENGTH)
    .setPlaceholder("z. B. Problem mit Verifizierung");

  const descriptionInput = new TextInputBuilder()
    .setCustomId(SUPPORT_TICKET_DESCRIPTION_INPUT_ID)
    .setLabel("Beschreibung")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(SUPPORT_TICKET_DESCRIPTION_MAX_LENGTH)
    .setPlaceholder("Bitte schildere dein Anliegen mit allen wichtigen Details.");

  modal.addComponents(
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(descriptionInput)
  );

  return modal;
}

export function buildSupportTicketOpenMessage(ticket, department) {
  const departmentName = department?.name || ticket.departmentId;
  const roleMentions = Array.isArray(department?.roleIds) && department.roleIds.length > 0
    ? department.roleIds.map((roleId) => `<@&${roleId}>`).join(" ")
    : "";

  const embed = new EmbedBuilder()
    .setColor(0x2ea043)
    .setTitle(ticket.ticketName || `Ticket ${ticket.id}`)
    .setDescription(ticket.ticketDescription || "Bitte beschreibe dein Anliegen so präzise wie möglich.")
    .addFields(
      { name: "Nutzer", value: `<@${ticket.userId}>`, inline: true },
      { name: "Department", value: departmentName, inline: true },
      { name: "Ticket-ID", value: ticket.id, inline: true }
    )
    .setFooter({ text: "Ein Teammitglied wird sich bald melden." });

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${SUPPORT_TICKET_ESCALATE_PREFIX}${ticket.id}`)
      .setLabel("Ticket eskalieren")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${SUPPORT_TICKET_CLOSE_PREFIX}${ticket.id}`)
      .setLabel("Ticket schließen")
      .setStyle(ButtonStyle.Danger)
  );

  return {
    content: roleMentions ? `${roleMentions}\nNeues Ticket von <@${ticket.userId}>` : `Neues Ticket von <@${ticket.userId}>`,
    embeds: [embed],
    components: [closeRow],
    allowedMentions: {
      parse: [],
      roles: Array.isArray(department?.roleIds) ? department.roleIds : []
    }
  };
}

export function buildSupportTicketEscalationSelectPayload(ticket, departments) {
  const safeDepartments = Array.isArray(departments) ? departments : [];
  const options = safeDepartments
    .filter((department) => department.id !== ticket.departmentId)
    .slice(0, 25)
    .map((department) => ({
      label: department.name.slice(0, 100),
      value: department.id,
      description: `ID: ${department.id}`.slice(0, 100)
    }));

  const select = new StringSelectMenuBuilder()
    .setCustomId(`${SUPPORT_TICKET_ESCALATE_SELECT_PREFIX}${ticket.id}`)
    .setPlaceholder("Ziel-Department auswählen")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  return {
    content: "Wähle das Department für die Eskalation dieses Tickets:",
    components: [new ActionRowBuilder().addComponents(select)]
  };
}
