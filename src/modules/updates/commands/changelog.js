import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { canManageServer } from "../../../core/permissions.js";

export const CHANGELOG_MODAL_ID = "updates_changelog_modal";
export const CHANGELOG_CATEGORY_MAX_LENGTH = 100;
export const CHANGELOG_NOTES_MAX_LENGTH = 3800;

export const changelogCommand = {
  data: new SlashCommandBuilder()
    .setName("changelog")
    .setDescription("Postet manuell einen Changelog-Eintrag im konfigurierten Updates-Kanal."),

  async execute({ client, interaction }) {
    if (!canManageServer(interaction.member)) {
      await interaction.reply({
        content: "Diesen Befehl dürfen nur Admins oder Mitglieder mit Server-verwalten nutzen.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const { moduleConfigStore } = client.botContext;
    const state = moduleConfigStore.getModuleState(interaction.guildId, "updates");

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
      .setValue("Allgemeine Änderungen")
      .setPlaceholder("z. B. Allgemeine Änderungen");

    const notesInput = new TextInputBuilder()
      .setCustomId("changelog_notes")
      .setLabel("Änderungen (je Zeile mit + oder -)")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(CHANGELOG_NOTES_MAX_LENGTH)
      .setPlaceholder("+Neue Funktion hinzugefügt\n-(SX-21) Schaden: 6*40 --> 6*25");

    modal.addComponents(
      new ActionRowBuilder().addComponents(categoryInput),
      new ActionRowBuilder().addComponents(notesInput)
    );

    await interaction.showModal(modal);
  }
};
