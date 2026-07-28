import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { canManageServer } from "../../../core/permissions.js";
import {
  ensureDefaultDepartment,
  getLeadDepartments
} from "../../support/services/config.js";
import { normalizeWeeklyReportConfig } from "../services/config.js";
import {
  buildDepartmentSelect,
  buildWeeklyReportSubmitModal,
  describeWeeklyReportConfig
} from "../services/panel.js";
import { buildWeeklyReportMessages, publishWeeklyReport } from "../services/publisher.js";
import { getWeeklyReport, listWeeklyReportsForWeek } from "../services/reports.js";
import { formatWeekLabel, getTargetWeekKey } from "../services/week.js";

export function getGuildDepartments(client, guildId) {
  const { settingsStore, env } = client.botContext;
  const supportState = settingsStore.getModuleState(guildId, "support");
  return ensureDefaultDepartment(
    supportState?.config?.departments,
    env.supportDefaultDepartmentName,
    []
  );
}

export function getSubmittableDepartments(client, guildId, member) {
  const departments = getGuildDepartments(client, guildId);
  if (canManageServer(member)) {
    return departments;
  }

  return getLeadDepartments(member, departments);
}

export function getWeeklyReportConfig(client, guildId) {
  const { settingsStore } = client.botContext;
  const moduleState = settingsStore.getModuleState(guildId, "weekly-report");
  return normalizeWeeklyReportConfig(moduleState?.config);
}

export const weeklyReportCommand = {
  data: new SlashCommandBuilder()
    .setName("wochenbericht")
    .setDescription("Wochenberichte der Support-Departments verwalten.")
    .addSubcommand((subcommand) => subcommand
      .setName("abgeben")
      .setDescription("Bericht für dein Department abgeben oder bearbeiten."))
    .addSubcommand((subcommand) => subcommand
      .setName("vorschau")
      .setDescription("Zeigt die aktuelle Fassung des Wochenberichts (nur für dich sichtbar)."))
    .addSubcommand((subcommand) => subcommand
      .setName("veroeffentlichen")
      .setDescription("Veröffentlicht den Wochenbericht sofort (nur Admins).")),

  async execute({ client, interaction }) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "Dieser Befehl funktioniert nur auf einem Server.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    const config = getWeeklyReportConfig(client, interaction.guildId);

    if (subcommand === "abgeben") {
      const departments = getSubmittableDepartments(client, interaction.guildId, interaction.member);

      if (departments.length === 0) {
        await interaction.reply({
          content: "Du bist in keinem Department als Leiter eingetragen. Leiter-Rollen werden über `/support-department set-leads` oder die Department-Verwaltung gesetzt.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const targetWeek = getTargetWeekKey(new Date(), config);

      if (departments.length === 1) {
        const department = departments[0];
        const existing = getWeeklyReport(interaction.guildId, targetWeek, department.id);
        await interaction.showModal(
          buildWeeklyReportSubmitModal(department, formatWeekLabel(targetWeek), existing?.content || "")
        );
        return;
      }

      await interaction.reply({
        ...buildDepartmentSelect(departments),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === "vorschau") {
      const isAdmin = canManageServer(interaction.member);
      const leadDepartments = getSubmittableDepartments(client, interaction.guildId, interaction.member);

      if (!isAdmin && leadDepartments.length === 0) {
        await interaction.reply({
          content: "Die Vorschau ist nur für Department-Leiter und Admins verfügbar.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const targetWeek = getTargetWeekKey(new Date(), config);
      const departments = getGuildDepartments(client, interaction.guildId);
      const reports = listWeeklyReportsForWeek(interaction.guildId, targetWeek);
      const messages = buildWeeklyReportMessages(targetWeek, departments, reports);

      const [firstMessage, ...followUps] = messages;
      await interaction.reply({
        content: `**Vorschau** (${describeWeeklyReportConfig(config).split("\n")[1]})\n${firstMessage.content || ""}`,
        embeds: firstMessage.embeds,
        flags: MessageFlags.Ephemeral
      });

      for (const followUp of followUps) {
        await interaction.followUp({
          embeds: followUp.embeds,
          flags: MessageFlags.Ephemeral
        });
      }
      return;
    }

    if (subcommand === "veroeffentlichen") {
      if (!canManageServer(interaction.member)) {
        await interaction.reply({
          content: "Nur Admins oder Mitglieder mit Server-verwalten dürfen den Bericht veröffentlichen.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (!config.publishChannelId) {
        await interaction.reply({
          content: "Es ist kein Veröffentlichungs-Channel konfiguriert. Bitte zuerst im Setup-Panel setzen.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const targetWeek = getTargetWeekKey(new Date(), config);
      const departments = getGuildDepartments(client, interaction.guildId);
      const published = await publishWeeklyReport(client, interaction.guild, targetWeek, departments, config);

      await interaction.editReply({
        content: published
          ? `Wochenbericht ${formatWeekLabel(targetWeek)} wurde in <#${config.publishChannelId}> veröffentlicht.`
          : "Veröffentlichung fehlgeschlagen: Der konfigurierte Channel ist nicht verfügbar."
      });
    }
  }
};
