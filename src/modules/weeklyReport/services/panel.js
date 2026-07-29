import {
  ActionRowBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { formatPublishSchedule } from "./config.js";

export const WEEKLY_REPORT_DEPT_SELECT_ID = "weekly_report_dept_select";
export const WEEKLY_REPORT_SUBMIT_MODAL_PREFIX = "weekly_report_submit_modal:";
export const WEEKLY_REPORT_CONTENT_INPUT_ID = "weekly_report_content";

export const WEEKLY_REPORT_CONTENT_MAX_LENGTH = 3900;

export function buildWeeklyReportSubmitModal(department, weekLabel, existingContent) {
  const modal = new ModalBuilder()
    .setCustomId(`${WEEKLY_REPORT_SUBMIT_MODAL_PREFIX}${department.id}`)
    .setTitle(`Bericht ${weekLabel}: ${department.name}`.slice(0, 45));

  const contentInput = new TextInputBuilder()
    .setCustomId(WEEKLY_REPORT_CONTENT_INPUT_ID)
    .setLabel("Berichtstext (Markdown möglich)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(WEEKLY_REPORT_CONTENT_MAX_LENGTH)
    .setPlaceholder("Leer absenden = bestehende Abgabe löschen");

  if (existingContent) {
    contentInput.setValue(String(existingContent).slice(0, WEEKLY_REPORT_CONTENT_MAX_LENGTH));
  }

  modal.addComponents(new ActionRowBuilder().addComponents(contentInput));
  return modal;
}

export function buildDepartmentSelect(departments) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(WEEKLY_REPORT_DEPT_SELECT_ID)
    .setPlaceholder("Department auswählen")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      departments.slice(0, 25).map((department) => ({
        label: department.name.slice(0, 100),
        description: `ID: ${department.id}`.slice(0, 100),
        value: department.id
      }))
    );

  return {
    content: "Für welches Department möchtest du den Bericht abgeben?",
    components: [new ActionRowBuilder().addComponents(select)]
  };
}

export function describeWeeklyReportConfig(config) {
  return [
    config.publishChannelId
      ? `Channel: <#${config.publishChannelId}>`
      : "Channel: (nicht gesetzt, Veröffentlichung pausiert)",
    `Termin: ${formatPublishSchedule(config)}`,
    config.reminderHoursBefore > 0
      ? `Erinnerung: ${config.reminderHoursBefore} h vorher`
      : "Erinnerung: aus"
  ].join("\n");
}
