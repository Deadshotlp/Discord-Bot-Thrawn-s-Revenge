import {
  ActionRowBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { formatPublishSchedule } from "./config.js";

export const WEEKLY_REPORT_SETUP_MODAL_ID = "weekly_report_setup_modal";
export const WEEKLY_REPORT_SETUP_CHANNEL_INPUT_ID = "weekly_report_setup_channel";
export const WEEKLY_REPORT_SETUP_WEEKDAY_INPUT_ID = "weekly_report_setup_weekday";
export const WEEKLY_REPORT_SETUP_TIME_INPUT_ID = "weekly_report_setup_time";
export const WEEKLY_REPORT_SETUP_REMINDER_INPUT_ID = "weekly_report_setup_reminder";

export const WEEKLY_REPORT_DEPT_SELECT_ID = "weekly_report_dept_select";
export const WEEKLY_REPORT_SUBMIT_MODAL_PREFIX = "weekly_report_submit_modal:";
export const WEEKLY_REPORT_CONTENT_INPUT_ID = "weekly_report_content";

export const WEEKLY_REPORT_CONTENT_MAX_LENGTH = 3900;

export function buildWeeklyReportSetupModal(config) {
  const modal = new ModalBuilder()
    .setCustomId(WEEKLY_REPORT_SETUP_MODAL_ID)
    .setTitle("Wochenberichte konfigurieren");

  const channelInput = new TextInputBuilder()
    .setCustomId(WEEKLY_REPORT_SETUP_CHANNEL_INPUT_ID)
    .setLabel("Veröffentlichungs-Channel (ID oder #)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder("Leer lassen = Veröffentlichung pausiert");

  if (config.publishChannelId) {
    channelInput.setValue(config.publishChannelId);
  }

  const weekdayInput = new TextInputBuilder()
    .setCustomId(WEEKLY_REPORT_SETUP_WEEKDAY_INPUT_ID)
    .setLabel("Wochentag (1-7 oder Montag..Sonntag)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder("Standard: Sonntag")
    .setValue(String(config.publishWeekday));

  const timeInput = new TextInputBuilder()
    .setCustomId(WEEKLY_REPORT_SETUP_TIME_INPUT_ID)
    .setLabel("Uhrzeit (HH:MM)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder("Standard: 18:00")
    .setValue(`${String(config.publishHour).padStart(2, "0")}:${String(config.publishMinute).padStart(2, "0")}`);

  const reminderInput = new TextInputBuilder()
    .setCustomId(WEEKLY_REPORT_SETUP_REMINDER_INPUT_ID)
    .setLabel("Erinnerung (Stunden vorher, 0 = aus)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder("Standard: 24")
    .setValue(String(config.reminderHoursBefore));

  modal.addComponents(
    new ActionRowBuilder().addComponents(channelInput),
    new ActionRowBuilder().addComponents(weekdayInput),
    new ActionRowBuilder().addComponents(timeInput),
    new ActionRowBuilder().addComponents(reminderInput)
  );

  return modal;
}

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
