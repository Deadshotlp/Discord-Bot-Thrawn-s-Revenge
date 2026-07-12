import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";

export const MEETING_TOPIC_MODAL_PREFIX = "meeting_topic_modal:";
export const MEETING_TOPIC_TITLE_INPUT_ID = "meeting_topic_title";
export const MEETING_TOPIC_DESC_INPUT_ID = "meeting_topic_desc";

export function buildTopicModal(meeting) {
  const modal = new ModalBuilder()
    .setCustomId(`${MEETING_TOPIC_MODAL_PREFIX}${meeting.id}`)
    .setTitle(`Thema: ${meeting.name}`.slice(0, 45));

  const titleInput = new TextInputBuilder()
    .setCustomId(MEETING_TOPIC_TITLE_INPUT_ID)
    .setLabel("Titel")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(200);

  const descInput = new TextInputBuilder()
    .setCustomId(MEETING_TOPIC_DESC_INPUT_ID)
    .setLabel("Beschreibung (optional)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1000);

  modal.addComponents(
    new ActionRowBuilder().addComponents(titleInput),
    new ActionRowBuilder().addComponents(descInput)
  );

  return modal;
}
