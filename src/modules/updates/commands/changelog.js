import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { canManageServer, hasAnyRole } from "../../../core/permissions.js";

export const CHANGELOG_MODAL_ID = "updates_changelog_modal";
export const CHANGELOG_CATEGORY_MAX_LENGTH = 100;
export const CHANGELOG_NOTES_MAX_LENGTH = 3800;

export function canPostChangelog(member, config) {
  return canManageServer(member) || hasAnyRole(member, config?.changelogRoleIds);
}

export const changelogCommand = {
  data: new SlashCommandBuilder()
    .setName("changelog")
    .setDescription("Postet manuell einen Changelog-Eintrag im konfigurierten Updates-Kanal."),

  async execute({ client, interaction }) {
    const { moduleConfigStore } = client.botContext;
    const state = moduleConfigStore.getModuleState(interaction.guildId, "updates");

    if (!canPostChangelog(interaction.member, state?.config)) {
      await interaction.reply({
        content: "Diesen Befehl dürfen nur Admins, Mitglieder mit Server-verwalten oder berechtigte Rollen nutzen.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (!state?.config?.channelId) {
      await interaction.reply({
        content: "Es ist noch kein Updates-Kanal konfiguriert. Nutze zuerst `/updates-channel`.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const modal = new ModalBuilder().setCustomId(CHANGELOG_MODAL_ID).setTitle("Changelog veröffentlichen");

    const categoryInput = new TextInputBuilder()
      .setCustomId("changelog_category")
      .setLabel("Kategorie")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(CHANGELOG_CATEGORY_MAX_LENGTH)
      .setPlaceholder("z. B. Discord, Gameserver, Allgemein");

    const notesInput = new TextInputBuilder()
      .setCustomId("changelog_notes")
      .setLabel("Änderungen (+ Hinzugefügt, ~ Geändert, - Gelöscht)")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(CHANGELOG_NOTES_MAX_LENGTH)
      .setPlaceholder("+Neue Funktion hinzugefügt\n~(SX-21) Schaden: 6*40 --> 6*25\n-Altes Feature entfernt");

    modal.addComponents(
      new ActionRowBuilder().addComponents(categoryInput),
      new ActionRowBuilder().addComponents(notesInput)
    );

    await interaction.showModal(modal);
  }
};
