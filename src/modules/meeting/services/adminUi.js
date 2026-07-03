import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { formatSchedule } from "./schedule.js";

export const MEETING_ADMIN_ADD_BUTTON = "meeting_admin_add";
export const MEETING_ADMIN_REFRESH_BUTTON = "meeting_admin_refresh";
export const MEETING_ADMIN_SELECT = "meeting_admin_select";

export const MEETING_ADMIN_ADD_MODAL = "meeting_admin_add_modal";
export const MEETING_ADMIN_ROLES_PREFIX = "meeting_admin_roles:";
export const MEETING_ADMIN_ORG_PREFIX = "meeting_admin_org:";
export const MEETING_ADMIN_TIME_PREFIX = "meeting_admin_time:";
export const MEETING_ADMIN_REMOVE_PREFIX = "meeting_admin_remove:";
export const MEETING_ADMIN_TOPICS_PREFIX = "meeting_admin_topics:";

export const MEETING_ADMIN_ROLES_MODAL_PREFIX = "meeting_admin_roles_modal:";
export const MEETING_ADMIN_ORG_MODAL_PREFIX = "meeting_admin_org_modal:";
export const MEETING_ADMIN_TIME_MODAL_PREFIX = "meeting_admin_time_modal:";

export const MEETING_ADMIN_NAME_INPUT = "meeting_admin_name";
export const MEETING_ADMIN_ANNOUNCE_INPUT = "meeting_admin_announce";
export const MEETING_ADMIN_VOICE_INPUT = "meeting_admin_voice";
export const MEETING_ADMIN_SCHEDULE_INPUT = "meeting_admin_schedule";
export const MEETING_ADMIN_INTERVAL_INPUT = "meeting_admin_interval";
export const MEETING_ADMIN_ROLES_INPUT = "meeting_admin_roles_input";
export const MEETING_ADMIN_LEAD_INPUT = "meeting_admin_lead_input";

export const MEETING_TOPIC_SELECT_PREFIX = "meeting_topic_select:";
export const MEETING_TOPIC_UP_PREFIX = "meeting_topic_up:";
export const MEETING_TOPIC_DOWN_PREFIX = "meeting_topic_down:";
export const MEETING_TOPIC_STANDING_PREFIX = "meeting_topic_standing:";
export const MEETING_TOPIC_DELETE_PREFIX = "meeting_topic_delete:";

function formatRoles(roleIds) {
  if (!Array.isArray(roleIds) || roleIds.length === 0) {
    return "(alle)";
  }

  return roleIds.map((roleId) => `<@&${roleId}>`).join(" ");
}

function formatOrganizers(roleIds) {
  if (!Array.isArray(roleIds) || roleIds.length === 0) {
    return "(nur Admins)";
  }

  return roleIds.map((roleId) => `<@&${roleId}>`).join(" ");
}

export function buildMeetingManagementPayload(meetings) {
  const embed = new EmbedBuilder()
    .setColor(0x8957e5)
    .setTitle("Meetings verwalten")
    .setDescription(
      meetings.length === 0
        ? "Noch keine Meetings. Mit „Meeting hinzufügen“ starten."
        : meetings
          .map((meeting) => [
            `**${meeting.name}** (\`${meeting.id}\`)`,
            `Zeit: ${formatSchedule(meeting)}`,
            `Ankündigung: ${meeting.announceChannelId ? `<#${meeting.announceChannelId}>` : "(nicht gesetzt)"}`,
            `Voice: ${meeting.voiceChannelId ? `<#${meeting.voiceChannelId}>` : "(nicht gesetzt)"}`,
            `Teilnehmer: ${formatRoles(meeting.participantRoleIds)}`,
            `Organisatoren: ${formatOrganizers(meeting.organizerRoleIds)}`
          ].join("\n"))
          .join("\n\n")
          .slice(0, 4000)
    );

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(MEETING_ADMIN_ADD_BUTTON).setLabel("Meeting hinzufügen").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(MEETING_ADMIN_REFRESH_BUTTON).setLabel("Aktualisieren").setStyle(ButtonStyle.Secondary)
  );

  const components = [actionRow];

  if (meetings.length > 0) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(MEETING_ADMIN_SELECT)
      .setPlaceholder("Meeting auswählen")
      .addOptions(meetings.slice(0, 25).map((meeting) => ({
        label: meeting.name.slice(0, 100),
        description: `ID: ${meeting.id}`.slice(0, 100),
        value: meeting.id
      })));
    components.push(new ActionRowBuilder().addComponents(select));
  }

  return { embeds: [embed], components };
}

export function buildMeetingActionsPayload(meeting) {
  const embed = new EmbedBuilder()
    .setColor(0x8957e5)
    .setTitle(`Meeting: ${meeting.name}`)
    .addFields(
      { name: "Zeit", value: formatSchedule(meeting), inline: false },
      { name: "Vorlauf", value: `${meeting.leadTimeHours} h vorher`, inline: true },
      { name: "Teilnehmer-Rollen", value: formatRoles(meeting.participantRoleIds), inline: false },
      { name: "Organisator-Rollen", value: formatOrganizers(meeting.organizerRoleIds), inline: false }
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${MEETING_ADMIN_TIME_PREFIX}${meeting.id}`).setLabel("Zeit/Vorlauf").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${MEETING_ADMIN_ROLES_PREFIX}${meeting.id}`).setLabel("Teilnehmer-Rollen").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${MEETING_ADMIN_ORG_PREFIX}${meeting.id}`).setLabel("Organisatoren").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${MEETING_ADMIN_TOPICS_PREFIX}${meeting.id}`).setLabel("Themen").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${MEETING_ADMIN_REMOVE_PREFIX}${meeting.id}`).setLabel("Entfernen").setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row] };
}

export function buildMeetingAddModal() {
  const modal = new ModalBuilder().setCustomId(MEETING_ADMIN_ADD_MODAL).setTitle("Meeting hinzufügen");

  const inputs = [
    new TextInputBuilder().setCustomId(MEETING_ADMIN_NAME_INPUT).setLabel("Name").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80),
    new TextInputBuilder().setCustomId(MEETING_ADMIN_ANNOUNCE_INPUT).setLabel("Ankündigungs-Channel (ID oder #)").setStyle(TextInputStyle.Short).setRequired(true),
    new TextInputBuilder().setCustomId(MEETING_ADMIN_VOICE_INPUT).setLabel("Voice-Channel (ID)").setStyle(TextInputStyle.Short).setRequired(false),
    new TextInputBuilder().setCustomId(MEETING_ADMIN_SCHEDULE_INPUT).setLabel("Termin, z. B. „Mittwoch 20:00“").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("Wochentag Uhrzeit"),
    new TextInputBuilder().setCustomId(MEETING_ADMIN_INTERVAL_INPUT).setLabel("Intervall in Wochen (1 = wöchentlich)").setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder("1")
  ];

  modal.addComponents(inputs.map((input) => new ActionRowBuilder().addComponents(input)));
  return modal;
}

export function buildRolesModal(meeting, isOrganizer) {
  const prefix = isOrganizer ? MEETING_ADMIN_ORG_MODAL_PREFIX : MEETING_ADMIN_ROLES_MODAL_PREFIX;
  const modal = new ModalBuilder()
    .setCustomId(`${prefix}${meeting.id}`)
    .setTitle((isOrganizer ? "Organisatoren: " : "Teilnehmer: ") + meeting.name.slice(0, 30));

  const current = isOrganizer ? meeting.organizerRoleIds : meeting.participantRoleIds;
  const input = new TextInputBuilder()
    .setCustomId(MEETING_ADMIN_ROLES_INPUT)
    .setLabel("Rollen (IDs oder Erwähnungen)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(400)
    .setPlaceholder(isOrganizer ? "Leer = nur Admins" : "Leer = alle dürfen");

  if (Array.isArray(current) && current.length > 0) {
    input.setValue(current.join(", ").slice(0, 400));
  }

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

export function buildTimeModal(meeting) {
  const modal = new ModalBuilder()
    .setCustomId(`${MEETING_ADMIN_TIME_MODAL_PREFIX}${meeting.id}`)
    .setTitle(`Zeit: ${meeting.name}`.slice(0, 45));

  const scheduleInput = new TextInputBuilder()
    .setCustomId(MEETING_ADMIN_SCHEDULE_INPUT)
    .setLabel("Termin, z. B. „Mittwoch 20:00“")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const intervalInput = new TextInputBuilder()
    .setCustomId(MEETING_ADMIN_INTERVAL_INPUT)
    .setLabel("Intervall in Wochen")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setValue(String(meeting.intervalWeeks));

  const leadInput = new TextInputBuilder()
    .setCustomId(MEETING_ADMIN_LEAD_INPUT)
    .setLabel("Vorlauf in Stunden")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setValue(String(meeting.leadTimeHours));

  modal.addComponents(
    new ActionRowBuilder().addComponents(scheduleInput),
    new ActionRowBuilder().addComponents(intervalInput),
    new ActionRowBuilder().addComponents(leadInput)
  );

  return modal;
}

export function buildTopicManagementPayload(meeting, topics) {
  const embed = new EmbedBuilder()
    .setColor(0x8957e5)
    .setTitle(`Themen: ${meeting.name}`)
    .setDescription(
      topics.length === 0
        ? "_Keine Themen._"
        : topics
          .map((topic, index) => `**${index + 1}.** ${topic.title}${topic.standing ? " 🔁 (Dauerthema)" : ""}`)
          .join("\n")
          .slice(0, 4000)
    );

  const components = [];
  if (topics.length > 0) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${MEETING_TOPIC_SELECT_PREFIX}${meeting.id}`)
      .setPlaceholder("Thema auswählen")
      .addOptions(topics.slice(0, 25).map((topic) => ({
        label: topic.title.slice(0, 100),
        description: topic.standing ? "Dauerthema" : "einmalig",
        value: topic.id
      })));
    components.push(new ActionRowBuilder().addComponents(select));
  }

  return { embeds: [embed], components };
}

export function buildTopicActionsPayload(meeting, topic) {
  return {
    content: `Thema **${topic.title}**${topic.standing ? " (Dauerthema)" : ""}`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${MEETING_TOPIC_UP_PREFIX}${meeting.id}:${topic.id}`).setLabel("▲ Hoch").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${MEETING_TOPIC_DOWN_PREFIX}${meeting.id}:${topic.id}`).setLabel("▼ Runter").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${MEETING_TOPIC_STANDING_PREFIX}${meeting.id}:${topic.id}`).setLabel(topic.standing ? "Dauerthema aus" : "Dauerthema an").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${MEETING_TOPIC_DELETE_PREFIX}${meeting.id}:${topic.id}`).setLabel("Entfernen").setStyle(ButtonStyle.Danger)
      )
    ]
  };
}

export function parseMeetingTopicCustomId(customId, prefix) {
  const rest = customId.slice(prefix.length);
  const separator = rest.indexOf(":");
  if (separator < 0) {
    return null;
  }

  return {
    meetingId: rest.slice(0, separator),
    topicId: rest.slice(separator + 1)
  };
}
