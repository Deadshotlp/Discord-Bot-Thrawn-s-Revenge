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
export const CHANGELOG_TITLE_MAX_LENGTH = 200;
export const CHANGELOG_VERSION_MAX_LENGTH = 50;
export const CHANGELOG_NOTES_MAX_LENGTH = 4000;

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

    const titleInput = new TextInputBuilder()
      .setCustomId("changelog_title")
      .setLabel("Titel")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(CHANGELOG_TITLE_MAX_LENGTH);

    const versionInput = new TextInputBuilder()
      .setCustomId("changelog_version")
      .setLabel("Version (optional)")
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(CHANGELOG_VERSION_MAX_LENGTH);

    const notesInput = new TextInputBuilder()
      .setCustomId("changelog_notes")
      .setLabel("Änderungen")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(CHANGELOG_NOTES_MAX_LENGTH);

    modal.addComponents(
      new ActionRowBuilder().addComponents(titleInput),
      new ActionRowBuilder().addComponents(versionInput),
      new ActionRowBuilder().addComponents(notesInput)
    );

    await interaction.showModal(modal);
  }
};
