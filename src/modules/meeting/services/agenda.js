import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} from "discord.js";
import { formatSchedule } from "./schedule.js";

export const MEETING_REGISTER_PREFIX = "meeting_register:";
export const MEETING_DECLINE_PREFIX = "meeting_decline:";
export const MEETING_TOPIC_ADD_PREFIX = "meeting_topic_add:";

const MEETING_COLOR = 0x8957e5;

function formatUserList(userIds, emptyText) {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return emptyText;
  }

  return userIds.map((userId) => `<@${userId}>`).join(", ");
}

export function buildAgendaLines(topics) {
  if (!Array.isArray(topics) || topics.length === 0) {
    return "_Noch keine Themen eingereicht._";
  }

  return topics
    .map((topic, index) => {
      const marker = topic.standing ? " 🔁" : "";
      const description = topic.description ? `\n   ${topic.description}` : "";
      return `**${index + 1}.** ${topic.title}${marker}${description}`;
    })
    .join("\n");
}

export function buildAnnouncementPayload({ meeting, occurrence, topics, registeredIds, declinedIds }) {
  const startTimestamp = Math.floor(occurrence.getTime() / 1000);

  const embed = new EmbedBuilder()
    .setColor(MEETING_COLOR)
    .setTitle(`📅 ${meeting.name}`)
    .setDescription([
      `**Beginn:** <t:${startTimestamp}:F> (<t:${startTimestamp}:R>)`,
      `**Rhythmus:** ${formatSchedule(meeting)}`,
      meeting.voiceChannelId ? `**Voice:** <#${meeting.voiceChannelId}>` : ""
    ].filter(Boolean).join("\n"))
    .addFields(
      { name: "Agenda", value: buildAgendaLines(topics).slice(0, 1024) },
      {
        name: `✅ Angemeldet (${registeredIds.length})`,
        value: formatUserList(registeredIds, "_niemand_").slice(0, 1024),
        inline: true
      },
      {
        name: `📝 Abgemeldet (${declinedIds.length})`,
        value: formatUserList(declinedIds, "_niemand_").slice(0, 1024),
        inline: true
      }
    );

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${MEETING_REGISTER_PREFIX}${meeting.id}`)
      .setLabel("Anmelden")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${MEETING_DECLINE_PREFIX}${meeting.id}`)
      .setLabel("Abmelden")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${MEETING_TOPIC_ADD_PREFIX}${meeting.id}`)
      .setLabel("Thema einreichen")
      .setStyle(ButtonStyle.Secondary)
  );

  const pingRoles = Array.isArray(meeting.participantRoleIds) ? meeting.participantRoleIds : [];

  return {
    content: pingRoles.length > 0 ? pingRoles.map((roleId) => `<@&${roleId}>`).join(" ") : undefined,
    embeds: [embed],
    components: [buttonRow],
    allowedMentions: { roles: pingRoles }
  };
}

export function buildEvaluationPayload({ meeting, occurrence, presentIds, excusedIds, absentIds }) {
  const startTimestamp = Math.floor(occurrence.getTime() / 1000);

  const embed = new EmbedBuilder()
    .setColor(MEETING_COLOR)
    .setTitle(`🧾 Anwesenheit: ${meeting.name}`)
    .setDescription(`Auswertung zu <t:${startTimestamp}:F>`)
    .addFields(
      {
        name: `✅ Anwesend (${presentIds.length})`,
        value: formatUserList(presentIds, "_niemand_").slice(0, 1024)
      },
      {
        name: `📝 Entschuldigt (${excusedIds.length})`,
        value: formatUserList(excusedIds, "_niemand_").slice(0, 1024)
      },
      {
        name: `❌ Unentschuldigt (${absentIds.length})`,
        value: formatUserList(absentIds, "_niemand_").slice(0, 1024)
      }
    );

  return { embeds: [embed], allowedMentions: { parse: [] } };
}
