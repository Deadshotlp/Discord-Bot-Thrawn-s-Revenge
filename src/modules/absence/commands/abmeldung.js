import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import { canManageServer } from "../../../core/permissions.js";
import { recordAudit } from "../../../core/audit.js";
import { normalizeAbsenceConfig } from "../services/config.js";
import { getDepartmentName, getDepartments, getMemberDepartments } from "../services/departments.js";
import { announceAbsence, describeAbsence, formatDate, refreshOverview } from "../services/announce.js";
import {
  ABSENCE_KINDS,
  ABSENCE_STATUS,
  createAbsence,
  daysBetween,
  getAbsence,
  groupByDepartment,
  listUpcomingAbsences,
  listUserAbsences,
  setAbsenceStatus,
  toIsoDate,
  todayIso
} from "../services/store.js";

const KIND_CHOICES = Object.values(ABSENCE_KINDS).map((kind) => ({
  name: `${kind.emoji} ${kind.label}`,
  value: kind.id
}));

export const abmeldungCommand = {
  data: new SlashCommandBuilder()
    .setName("abmeldung")
    .setDescription("Abwesenheiten im Team melden und einsehen")
    .setDMPermission(false)
    .addSubcommand((subcommand) => subcommand
      .setName("melden")
      .setDescription("Abwesenheit eintragen")
      .addStringOption((option) => option
        .setName("von")
        .setDescription("Startdatum, z. B. 24.12.2026")
        .setRequired(true))
      .addStringOption((option) => option
        .setName("bis")
        .setDescription("Enddatum (leer = gleicher Tag)"))
      .addStringOption((option) => option
        .setName("art")
        .setDescription("Art der Abwesenheit")
        .addChoices(...KIND_CHOICES))
      .addStringOption((option) => option
        .setName("bereich")
        .setDescription("Department (leer = automatisch aus deinen Rollen)")
        .setAutocomplete(true))
      .addStringOption((option) => option
        .setName("grund")
        .setDescription("Optionaler Hinweis für das Team")
        .setMaxLength(300)))
    .addSubcommand((subcommand) => subcommand
      .setName("meine")
      .setDescription("Deine eingetragenen Abwesenheiten anzeigen"))
    .addSubcommand((subcommand) => subcommand
      .setName("zurueckziehen")
      .setDescription("Eine eigene Abmeldung zurückziehen")
      .addStringOption((option) => option
        .setName("eintrag")
        .setDescription("Abmeldung")
        .setRequired(true)
        .setAutocomplete(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("liste")
      .setDescription("Wer ist wann nicht da?")
      .addStringOption((option) => option
        .setName("bereich")
        .setDescription("Nur ein Department")
        .setAutocomplete(true))
      .addIntegerOption((option) => option
        .setName("tage")
        .setDescription("Vorschau in Tagen (Standard 21)")
        .setMinValue(1)
        .setMaxValue(120)))
    .addSubcommand((subcommand) => subcommand
      .setName("freigeben")
      .setDescription("Offene Abmeldung freigeben oder ablehnen (Leitung/Admin)")
      .addStringOption((option) => option
        .setName("eintrag")
        .setDescription("Abmeldung")
        .setRequired(true)
        .setAutocomplete(true))
      .addBooleanOption((option) => option
        .setName("freigeben")
        .setDescription("true = freigeben, false = ablehnen")
        .setRequired(true))),

  async autocomplete({ client, interaction }) {
    const focused = interaction.options.getFocused(true);
    const departments = getDepartments(client, interaction.guildId);
    const query = String(focused.value || "").toLowerCase();

    if (focused.name === "bereich") {
      await interaction.respond(
        departments
          .filter((department) => department.name.toLowerCase().includes(query))
          .slice(0, 25)
          .map((department) => ({ name: department.name, value: department.id }))
      );
      return;
    }

    if (focused.name === "eintrag") {
      const subcommand = interaction.options.getSubcommand();
      const entries = subcommand === "freigeben"
        ? listUpcomingAbsences(interaction.guildId, 120).filter((absence) => absence.status === ABSENCE_STATUS.pending)
        : listUserAbsences(interaction.guildId, interaction.user.id);

      await interaction.respond(
        entries.slice(0, 25).map((absence) => ({
          name: `${formatDate(absence.startsOn)}–${formatDate(absence.endsOn)} · ${ABSENCE_KINDS[absence.kind]?.label || absence.kind}`.slice(0, 100),
          value: absence.id
        }))
      );
      return;
    }

    await interaction.respond([]);
  },

  async execute({ client, interaction }) {
    const { settingsStore } = client.botContext;
    const config = normalizeAbsenceConfig(settingsStore.getModuleState(interaction.guildId, "absence")?.config);
    const departments = getDepartments(client, interaction.guildId);
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "melden") {
      if (!config.allowSelfService && !canManageServer(interaction.member)) {
        await interaction.reply({
          content: "Abmeldungen werden auf diesem Server über das Dashboard eingetragen.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const startsOn = toIsoDate(interaction.options.getString("von", true));
      const endsOn = toIsoDate(interaction.options.getString("bis") || startsOn);

      if (!startsOn || !endsOn) {
        await interaction.reply({
          content: "Datum konnte nicht gelesen werden. Nutze z. B. `24.12.2026` oder `2026-12-24`.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const length = daysBetween(startsOn, endsOn);
      if (length > config.maxDays) {
        await interaction.reply({
          content: `Der Zeitraum ist länger als erlaubt (max. ${config.maxDays} Tage). Bitte an die Leitung wenden.`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const explicitDepartment = interaction.options.getString("bereich");
      const departmentIds = explicitDepartment
        ? [explicitDepartment]
        : getMemberDepartments(interaction.member, departments).map((department) => department.id);

      let absence;
      try {
        absence = createAbsence({
          guildId: interaction.guildId,
          userId: interaction.user.id,
          departmentIds,
          startsOn,
          endsOn,
          kind: interaction.options.getString("art") || "abwesend",
          reason: interaction.options.getString("grund") || "",
          status: config.requireApproval ? ABSENCE_STATUS.pending : ABSENCE_STATUS.active,
          createdBy: interaction.user.id
        });
      } catch (error) {
        await interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral });
        return;
      }

      recordAudit({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        actorName: interaction.user.username,
        action: "absence.create",
        detail: { absenceId: absence.id, startsOn, endsOn }
      });

      await interaction.reply({
        content: [
          `Eingetragen: **${formatDate(startsOn)} – ${formatDate(endsOn)}** (${length} ${length === 1 ? "Tag" : "Tage"}).`,
          departmentIds.length > 0
            ? `Bereich: ${departmentIds.map((id) => getDepartmentName(departments, id)).join(", ")}`
            : "Bereich: Allgemein",
          config.requireApproval ? "Status: wartet auf Freigabe durch die Leitung." : ""
        ].filter(Boolean).join("\n"),
        flags: MessageFlags.Ephemeral
      });

      await announceAbsence(client, absence, { action: "created" });
      await refreshOverview(client, interaction.guildId);
      return;
    }

    if (subcommand === "meine") {
      const entries = listUserAbsences(interaction.guildId, interaction.user.id);
      if (entries.length === 0) {
        await interaction.reply({
          content: "Du hast keine offenen Abmeldungen.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle("Deine Abmeldungen")
          .setColor(0x5865f2)
          .setDescription(entries.map((absence) => describeAbsence(absence, departments).line).join("\n"))],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === "zurueckziehen") {
      const absenceId = interaction.options.getString("eintrag", true);
      const absence = getAbsence(absenceId);

      if (!absence || absence.guildId !== interaction.guildId) {
        await interaction.reply({ content: "Eintrag nicht gefunden.", flags: MessageFlags.Ephemeral });
        return;
      }

      if (absence.userId !== interaction.user.id && !canManageServer(interaction.member)) {
        await interaction.reply({
          content: "Du kannst nur eigene Abmeldungen zurückziehen.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      setAbsenceStatus(absenceId, ABSENCE_STATUS.cancelled);
      recordAudit({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        actorName: interaction.user.username,
        action: "absence.cancel",
        detail: { absenceId }
      });

      await interaction.reply({
        content: `Abmeldung vom ${formatDate(absence.startsOn)} wurde zurückgezogen.`,
        flags: MessageFlags.Ephemeral
      });

      await announceAbsence(client, getAbsence(absenceId), { action: "cancelled" });
      await refreshOverview(client, interaction.guildId);
      return;
    }

    if (subcommand === "liste") {
      const days = interaction.options.getInteger("tage") || config.overviewDays;
      const departmentFilter = interaction.options.getString("bereich");
      const today = todayIso();

      let entries = listUpcomingAbsences(interaction.guildId, days, today)
        .filter((absence) => absence.status !== ABSENCE_STATUS.cancelled);

      if (departmentFilter) {
        entries = entries.filter((absence) => absence.departmentIds.includes(departmentFilter));
      }

      if (entries.length === 0) {
        await interaction.reply({
          content: "Für diesen Zeitraum liegen keine Abmeldungen vor.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(`Abmeldungen · nächste ${days} Tage`)
        .setColor(0x5865f2);

      for (const [departmentId, list] of groupByDepartment(entries)) {
        embed.addFields({
          name: getDepartmentName(departments, departmentId),
          value: list
            .slice(0, 15)
            .map((absence) => describeAbsence(absence, departments).line)
            .join("\n")
            .slice(0, 1024)
        });
      }

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (subcommand === "freigeben") {
      const absenceId = interaction.options.getString("eintrag", true);
      const approve = interaction.options.getBoolean("freigeben", true);
      const absence = getAbsence(absenceId);

      if (!absence || absence.guildId !== interaction.guildId) {
        await interaction.reply({ content: "Eintrag nicht gefunden.", flags: MessageFlags.Ephemeral });
        return;
      }

      const isLead = absence.departmentIds.some((departmentId) => {
        const department = departments.find((entry) => entry.id === departmentId);
        return department?.leadRoleIds?.some((roleId) => interaction.member.roles.cache.has(roleId));
      });

      if (!isLead && !canManageServer(interaction.member)) {
        await interaction.reply({
          content: "Nur die Bereichsleitung oder Admins dürfen Abmeldungen freigeben.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const updated = setAbsenceStatus(
        absenceId,
        approve ? ABSENCE_STATUS.active : ABSENCE_STATUS.rejected
      );

      recordAudit({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        actorName: interaction.user.username,
        action: approve ? "absence.approve" : "absence.reject",
        detail: { absenceId }
      });

      await interaction.reply({
        content: approve ? "Abmeldung freigegeben." : "Abmeldung abgelehnt.",
        flags: MessageFlags.Ephemeral
      });

      await announceAbsence(client, updated, { action: approve ? "approved" : "rejected" });
      await refreshOverview(client, interaction.guildId);
    }
  }
};
