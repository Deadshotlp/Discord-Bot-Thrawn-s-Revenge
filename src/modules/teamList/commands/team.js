import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { canManageServer, hasAnyRole } from "../../../core/permissions.js";
import { getDepartments } from "../../absence/services/departments.js";
import { MemberIntentError, collectRoster } from "../services/roster.js";
import { buildRosterEmbeds } from "../services/render.js";

function isLeadAnywhere(member, departments) {
  return departments.some((department) => hasAnyRole(member, department.leadRoleIds || []));
}

export const teamCommand = {
  data: new SlashCommandBuilder()
    .setName("team")
    .setDescription("Wer ist im Team?")
    .setDMPermission(false)
    .addSubcommand((subcommand) => subcommand
      .setName("liste")
      .setDescription("Teamliste nach Departments, mit Leitung und Abmeldungen")
      .addStringOption((option) => option
        .setName("bereich")
        .setDescription("Nur ein Department")
        .setAutocomplete(true))
      .addBooleanOption((option) => option
        .setName("oeffentlich")
        .setDescription("Für alle im Channel sichtbar posten (Leitung/Admin)"))),

  async autocomplete({ client, interaction }) {
    const focused = interaction.options.getFocused(true);

    if (focused.name !== "bereich") {
      await interaction.respond([]);
      return;
    }

    const query = String(focused.value || "").toLowerCase();

    await interaction.respond(
      getDepartments(client, interaction.guildId)
        .filter((department) => department.name.toLowerCase().includes(query))
        .slice(0, 25)
        .map((department) => ({ name: department.name, value: department.id }))
    );
  },

  async execute({ client, interaction }) {
    const departments = getDepartments(client, interaction.guildId);
    const wantsPublic = interaction.options.getBoolean("oeffentlich") === true;
    const mayPostPublicly = canManageServer(interaction.member) || isLeadAnywhere(interaction.member, departments);
    const isPublic = wantsPublic && mayPostPublicly;

    await interaction.deferReply(isPublic ? {} : { flags: MessageFlags.Ephemeral });

    if (wantsPublic && !mayPostPublicly) {
      await interaction.editReply(
        "Öffentlich posten dürfen nur die Bereichsleitung und Admins. Hier ist die Liste nur für dich:"
      );
    }

    let roster;

    try {
      roster = await collectRoster(client, interaction.guildId);
    } catch (error) {
      if (error instanceof MemberIntentError) {
        await interaction.editReply(error.message);
        return;
      }

      client.botContext.logger.warn("Teamliste konnte nicht erstellt werden", {
        guildId: interaction.guildId,
        error: String(error)
      });

      await interaction.editReply("Die Teamliste konnte nicht geladen werden.");
      return;
    }

    const departmentId = interaction.options.getString("bereich") || "";

    if (departmentId && !roster.departments.some((group) => group.id === departmentId)) {
      await interaction.editReply("Dieses Department gibt es nicht.");
      return;
    }

    await interaction.editReply({
      embeds: buildRosterEmbeds(roster, { guildName: interaction.guild?.name || "", departmentId })
    });
  }
};
