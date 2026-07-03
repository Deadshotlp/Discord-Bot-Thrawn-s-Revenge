import { MessageFlags } from "discord.js";
import { extractSnowflake, resolveTextAnnouncementChannel } from "../../core/discordUtil.js";
import { canManageServer } from "../../core/permissions.js";
import { getDepartmentById, isDepartmentLead } from "../support/services/config.js";
import {
  normalizeWeeklyReportConfig,
  parseTimeInput,
  parseWeekdayInput
} from "./services/config.js";
import {
  buildWeeklyReportSubmitModal,
  describeWeeklyReportConfig,
  WEEKLY_REPORT_CONTENT_INPUT_ID,
  WEEKLY_REPORT_DEPT_SELECT_ID,
  WEEKLY_REPORT_SETUP_CHANNEL_INPUT_ID,
  WEEKLY_REPORT_SETUP_MODAL_ID,
  WEEKLY_REPORT_SETUP_REMINDER_INPUT_ID,
  WEEKLY_REPORT_SETUP_TIME_INPUT_ID,
  WEEKLY_REPORT_SETUP_WEEKDAY_INPUT_ID,
  WEEKLY_REPORT_SUBMIT_MODAL_PREFIX
} from "./services/panel.js";
import { publishWeeklyReport, sendWeeklyReminder } from "./services/publisher.js";
import {
  closeWeeklyReportsDb,
  deleteWeeklyReport,
  getWeeklyReport,
  hasUnpublishedReports,
  upsertWeeklyReport
} from "./services/reports.js";
import {
  formatWeekLabel,
  getIsoWeekKey,
  getPreviousWeekKey,
  getPublishMoment,
  getTargetWeekKey
} from "./services/week.js";
import {
  getGuildDepartments,
  getSubmittableDepartments,
  getWeeklyReportConfig,
  weeklyReportCommand
} from "./commands/weeklyReport.js";

const CHECK_INTERVAL_MS = 60 * 1000;

const runtime = {
  timer: null,
  running: false
};

async function processGuildTick(client, guild, now) {
  const config = getWeeklyReportConfig(client, guild.id);
  if (!config.publishChannelId) {
    return;
  }

  const currentWeek = getIsoWeekKey(now);
  const publishMoment = getPublishMoment(now, config);
  const departments = getGuildDepartments(client, guild.id);

  if (
    config.reminderHoursBefore > 0
    && config.lastReminderWeek !== currentWeek
    && config.lastPublishedWeek !== currentWeek
    && now.getTime() >= publishMoment.getTime() - config.reminderHoursBefore * 60 * 60 * 1000
    && now.getTime() < publishMoment.getTime()
  ) {
    await sendWeeklyReminder(client, guild, currentWeek, departments, config, publishMoment);
    return;
  }

  if (now.getTime() >= publishMoment.getTime()) {
    if (config.lastPublishedWeek !== currentWeek) {
      await publishWeeklyReport(client, guild, currentWeek, departments, config);
    }
    return;
  }

  // Katchup: Der Termin der Vorwoche wurde verpasst (Bot war offline),
  // aber es liegen noch unveröffentlichte Abgaben vor.
  const previousWeek = getPreviousWeekKey(now);
  if (config.lastPublishedWeek !== previousWeek && hasUnpublishedReports(guild.id, previousWeek)) {
    await publishWeeklyReport(client, guild, previousWeek, departments, config);
  }
}

async function runWeeklyReportCycle(client) {
  if (runtime.running) {
    return;
  }

  runtime.running = true;
  try {
    const now = new Date();
    for (const guild of client.guilds.cache.values()) {
      if (!client.botContext.moduleConfigStore.isModuleEnabled(guild.id, "weekly-report")) {
        continue;
      }

      await processGuildTick(client, guild, now).catch((error) => {
        client.botContext.logger.warn("Wochenbericht-Zyklus fehlgeschlagen", {
          guildId: guild.id,
          error: String(error)
        });
      });
    }
  } finally {
    runtime.running = false;
  }
}

async function handleWeeklyReportReady({ client }) {
  if (runtime.timer) {
    return;
  }

  await runWeeklyReportCycle(client);

  runtime.timer = setInterval(() => {
    runWeeklyReportCycle(client).catch((error) => {
      client.botContext.logger.warn("Wochenbericht-Zyklus fehlgeschlagen", {
        error: String(error)
      });
    });
  }, CHECK_INTERVAL_MS);
}

async function handleWeeklyReportShutdown() {
  if (runtime.timer) {
    clearInterval(runtime.timer);
    runtime.timer = null;
  }

  closeWeeklyReportsDb();
}

handleWeeklyReportShutdown.alwaysAvailable = true;

async function handleSetupModalSubmit({ client, interaction }) {
  if (!canManageServer(interaction.member)) {
    await interaction.reply({
      content: "Nur Admins oder Mitglieder mit Server-verwalten dürfen dies konfigurieren.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const channelInput = interaction.fields.getTextInputValue(WEEKLY_REPORT_SETUP_CHANNEL_INPUT_ID)?.trim() || "";
  const weekdayInput = interaction.fields.getTextInputValue(WEEKLY_REPORT_SETUP_WEEKDAY_INPUT_ID)?.trim() || "";
  const timeInput = interaction.fields.getTextInputValue(WEEKLY_REPORT_SETUP_TIME_INPUT_ID)?.trim() || "";
  const reminderInput = interaction.fields.getTextInputValue(WEEKLY_REPORT_SETUP_REMINDER_INPUT_ID)?.trim() || "";

  const currentConfig = getWeeklyReportConfig(client, interaction.guildId);

  let publishChannelId = "";
  if (channelInput) {
    const channelId = extractSnowflake(channelInput);
    const channel = await resolveTextAnnouncementChannel(interaction.guild, channelId);
    if (!channel) {
      await interaction.reply({
        content: "Veröffentlichungs-Channel ist ungültig. Bitte ID oder #Erwähnung eines Textkanals nutzen.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    publishChannelId = channel.id;
  }

  const publishWeekday = weekdayInput ? parseWeekdayInput(weekdayInput) : currentConfig.publishWeekday;
  if (!publishWeekday) {
    await interaction.reply({
      content: "Ungültiger Wochentag. Bitte 1-7 oder z. B. \"Sonntag\" angeben.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const time = timeInput
    ? parseTimeInput(timeInput)
    : { hour: currentConfig.publishHour, minute: currentConfig.publishMinute };
  if (!time) {
    await interaction.reply({
      content: "Ungültige Uhrzeit. Bitte im Format HH:MM angeben.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const reminderHoursBefore = reminderInput === ""
    ? currentConfig.reminderHoursBefore
    : Number.parseInt(reminderInput, 10);
  if (!Number.isInteger(reminderHoursBefore) || reminderHoursBefore < 0 || reminderHoursBefore > 168) {
    await interaction.reply({
      content: "Ungültige Erinnerungszeit. Bitte 0 (aus) bis 168 Stunden angeben.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const nextConfig = normalizeWeeklyReportConfig({
    ...currentConfig,
    publishChannelId,
    publishWeekday,
    publishHour: time.hour,
    publishMinute: time.minute,
    reminderHoursBefore
  });

  client.botContext.moduleConfigStore.setModuleConfig(interaction.guildId, "weekly-report", nextConfig);

  await interaction.reply({
    content: `Wochenbericht-Konfiguration gespeichert.\n${describeWeeklyReportConfig(nextConfig)}`,
    flags: MessageFlags.Ephemeral
  });
}

async function handleDepartmentSelect({ client, interaction }) {
  const departments = getSubmittableDepartments(client, interaction.guildId, interaction.member);
  const selectedId = interaction.values?.[0] || "";
  const department = departments.find((entry) => entry.id === selectedId);

  if (!department) {
    await interaction.reply({
      content: "Für dieses Department darfst du keinen Bericht abgeben.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const config = getWeeklyReportConfig(client, interaction.guildId);
  const targetWeek = getTargetWeekKey(new Date(), config);
  const existing = getWeeklyReport(interaction.guildId, targetWeek, department.id);

  await interaction.showModal(
    buildWeeklyReportSubmitModal(department, formatWeekLabel(targetWeek), existing?.content || "")
  );
}

async function handleSubmitModal({ client, interaction }) {
  const departmentId = interaction.customId.slice(WEEKLY_REPORT_SUBMIT_MODAL_PREFIX.length);
  const departments = getGuildDepartments(client, interaction.guildId);
  const department = getDepartmentById(departments, departmentId);

  if (!department) {
    await interaction.reply({
      content: "Department nicht gefunden.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!canManageServer(interaction.member) && !isDepartmentLead(interaction.member, department)) {
    await interaction.reply({
      content: "Für dieses Department darfst du keinen Bericht abgeben.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const config = getWeeklyReportConfig(client, interaction.guildId);
  const targetWeek = getTargetWeekKey(new Date(), config);
  const content = interaction.fields.getTextInputValue(WEEKLY_REPORT_CONTENT_INPUT_ID)?.trim() || "";

  if (!content) {
    const removed = deleteWeeklyReport(interaction.guildId, targetWeek, department.id);
    await interaction.reply({
      content: removed
        ? `Abgabe für ${department.name} (${formatWeekLabel(targetWeek)}) wurde gelöscht.`
        : `Keine Abgabe für ${department.name} (${formatWeekLabel(targetWeek)}) vorhanden.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  upsertWeeklyReport({
    guildId: interaction.guildId,
    week: targetWeek,
    departmentId: department.id,
    authorId: interaction.user.id,
    content
  });

  await interaction.reply({
    content: [
      `Bericht für **${department.name}** (${formatWeekLabel(targetWeek)}) gespeichert.`,
      "Er kann bis zur Veröffentlichung über `/wochenbericht abgeben` bearbeitet werden."
    ].join("\n"),
    flags: MessageFlags.Ephemeral
  });
}

async function handleWeeklyReportInteraction({ client, interaction }) {
  if (!interaction.inGuild()) {
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId === WEEKLY_REPORT_SETUP_MODAL_ID) {
    await handleSetupModalSubmit({ client, interaction });
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === WEEKLY_REPORT_DEPT_SELECT_ID) {
    await handleDepartmentSelect({ client, interaction });
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith(WEEKLY_REPORT_SUBMIT_MODAL_PREFIX)) {
    await handleSubmitModal({ client, interaction });
  }
}

handleWeeklyReportInteraction.alwaysAvailable = true;

export const weeklyReportModule = {
  name: "weekly-report",
  defaultEnabled: false,
  defaultConfig: {
    publishChannelId: "",
    publishWeekday: 7,
    publishHour: 18,
    publishMinute: 0,
    reminderHoursBefore: 24,
    lastPublishedWeek: "",
    lastReminderWeek: ""
  },
  commands: [weeklyReportCommand],
  events: {
    ready: [handleWeeklyReportReady],
    interactionCreate: [handleWeeklyReportInteraction],
    shutdown: [handleWeeklyReportShutdown]
  }
};
