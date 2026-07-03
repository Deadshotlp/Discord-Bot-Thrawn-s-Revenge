import { MessageFlags } from "discord.js";
import { canManageServer } from "../../../core/permissions.js";
import { extractSnowflake } from "../../../core/discordUtil.js";
import {
  createUniqueMeetingId,
  getMeetingById,
  normalizeMeetingModuleConfig,
  parseRoleIds
} from "../services/config.js";
import { parseTimeInput, parseWeekdayInput } from "../services/schedule.js";
import {
  buildMeetingActionsPayload,
  buildMeetingAddModal,
  buildMeetingManagementPayload,
  buildRolesModal,
  buildTimeModal,
  buildTopicActionsPayload,
  buildTopicManagementPayload,
  MEETING_ADMIN_ADD_BUTTON,
  MEETING_ADMIN_ADD_MODAL,
  MEETING_ADMIN_ANNOUNCE_INPUT,
  MEETING_ADMIN_INTERVAL_INPUT,
  MEETING_ADMIN_LEAD_INPUT,
  MEETING_ADMIN_NAME_INPUT,
  MEETING_ADMIN_ORG_MODAL_PREFIX,
  MEETING_ADMIN_ORG_PREFIX,
  MEETING_ADMIN_REFRESH_BUTTON,
  MEETING_ADMIN_REMOVE_PREFIX,
  MEETING_ADMIN_ROLES_INPUT,
  MEETING_ADMIN_ROLES_MODAL_PREFIX,
  MEETING_ADMIN_ROLES_PREFIX,
  MEETING_ADMIN_SCHEDULE_INPUT,
  MEETING_ADMIN_SELECT,
  MEETING_ADMIN_TIME_MODAL_PREFIX,
  MEETING_ADMIN_TIME_PREFIX,
  MEETING_ADMIN_TOPICS_PREFIX,
  MEETING_ADMIN_VOICE_INPUT,
  MEETING_TOPIC_DELETE_PREFIX,
  MEETING_TOPIC_DOWN_PREFIX,
  MEETING_TOPIC_SELECT_PREFIX,
  MEETING_TOPIC_STANDING_PREFIX,
  MEETING_TOPIC_UP_PREFIX,
  parseMeetingTopicCustomId
} from "../services/adminUi.js";
import {
  getMeetingTopic,
  listMeetingTopics,
  moveMeetingTopic,
  removeMeetingTopic,
  setMeetingTopicStanding
} from "../services/store.js";

function getMeetings(client, guildId) {
  const state = client.botContext.moduleConfigStore.getModuleState(guildId, "meeting");
  return normalizeMeetingModuleConfig(state?.config).meetings;
}

function saveMeetings(client, guildId, meetings) {
  client.botContext.moduleConfigStore.setModuleConfig(guildId, "meeting", { meetings });
}

function parseSchedule(scheduleRaw) {
  const parts = String(scheduleRaw || "").trim().split(/\s+/);
  if (parts.length < 2) {
    return null;
  }

  const weekday = parseWeekdayInput(parts[0]);
  const time = parseTimeInput(parts[1]);
  if (!weekday || !time) {
    return null;
  }

  return { weekday, hour: time.hour, minute: time.minute };
}

const ADMIN_BUTTON_PREFIXES = [
  MEETING_ADMIN_ROLES_PREFIX,
  MEETING_ADMIN_ORG_PREFIX,
  MEETING_ADMIN_TIME_PREFIX,
  MEETING_ADMIN_REMOVE_PREFIX,
  MEETING_ADMIN_TOPICS_PREFIX,
  MEETING_TOPIC_UP_PREFIX,
  MEETING_TOPIC_DOWN_PREFIX,
  MEETING_TOPIC_STANDING_PREFIX,
  MEETING_TOPIC_DELETE_PREFIX
];

const ADMIN_MODAL_PREFIXES = [
  MEETING_ADMIN_ROLES_MODAL_PREFIX,
  MEETING_ADMIN_ORG_MODAL_PREFIX,
  MEETING_ADMIN_TIME_MODAL_PREFIX
];

function isAdminInteraction(interaction) {
  if (interaction.isButton()) {
    return interaction.customId === MEETING_ADMIN_ADD_BUTTON
      || interaction.customId === MEETING_ADMIN_REFRESH_BUTTON
      || ADMIN_BUTTON_PREFIXES.some((prefix) => interaction.customId.startsWith(prefix));
  }

  if (interaction.isStringSelectMenu()) {
    return interaction.customId === MEETING_ADMIN_SELECT
      || interaction.customId.startsWith(MEETING_TOPIC_SELECT_PREFIX);
  }

  if (interaction.isModalSubmit()) {
    return interaction.customId === MEETING_ADMIN_ADD_MODAL
      || ADMIN_MODAL_PREFIXES.some((prefix) => interaction.customId.startsWith(prefix));
  }

  return false;
}

async function meetingNotFound(interaction) {
  await interaction.reply({ content: "Meeting nicht gefunden.", flags: MessageFlags.Ephemeral });
}

// Gibt true zurück, wenn die Interaktion behandelt wurde.
export async function handleMeetingAdminInteraction({ client, interaction }) {
  if (!interaction.inGuild() || !isAdminInteraction(interaction)) {
    return false;
  }

  if (!canManageServer(interaction.member)) {
    await interaction.reply({
      content: "Nur Admins oder Mitglieder mit Server-verwalten dürfen Meetings verwalten.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const meetings = getMeetings(client, interaction.guildId);

  if (interaction.isButton() && interaction.customId === MEETING_ADMIN_REFRESH_BUTTON) {
    await interaction.update(buildMeetingManagementPayload(meetings));
    return true;
  }

  if (interaction.isButton() && interaction.customId === MEETING_ADMIN_ADD_BUTTON) {
    await interaction.showModal(buildMeetingAddModal());
    return true;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === MEETING_ADMIN_SELECT) {
    const meeting = getMeetingById(meetings, interaction.values?.[0]);
    if (!meeting) {
      return meetingNotFound(interaction).then(() => true);
    }
    await interaction.reply({ ...buildMeetingActionsPayload(meeting), flags: MessageFlags.Ephemeral });
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId === MEETING_ADMIN_ADD_MODAL) {
    return handleAddModal({ client, interaction, meetings });
  }

  if (interaction.isButton() && interaction.customId.startsWith(MEETING_ADMIN_TIME_PREFIX)) {
    const meeting = getMeetingById(meetings, interaction.customId.slice(MEETING_ADMIN_TIME_PREFIX.length));
    if (!meeting) {
      return meetingNotFound(interaction).then(() => true);
    }
    await interaction.showModal(buildTimeModal(meeting));
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(MEETING_ADMIN_ROLES_PREFIX)) {
    const meeting = getMeetingById(meetings, interaction.customId.slice(MEETING_ADMIN_ROLES_PREFIX.length));
    if (!meeting) {
      return meetingNotFound(interaction).then(() => true);
    }
    await interaction.showModal(buildRolesModal(meeting, false));
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(MEETING_ADMIN_ORG_PREFIX)) {
    const meeting = getMeetingById(meetings, interaction.customId.slice(MEETING_ADMIN_ORG_PREFIX.length));
    if (!meeting) {
      return meetingNotFound(interaction).then(() => true);
    }
    await interaction.showModal(buildRolesModal(meeting, true));
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(MEETING_ADMIN_REMOVE_PREFIX)) {
    const meetingId = interaction.customId.slice(MEETING_ADMIN_REMOVE_PREFIX.length);
    const updated = meetings.filter((meeting) => meeting.id !== meetingId);
    saveMeetings(client, interaction.guildId, updated);
    await interaction.update({ content: `Meeting \`${meetingId}\` wurde entfernt.`, embeds: [], components: [] });
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(MEETING_ADMIN_TOPICS_PREFIX)) {
    const meeting = getMeetingById(meetings, interaction.customId.slice(MEETING_ADMIN_TOPICS_PREFIX.length));
    if (!meeting) {
      return meetingNotFound(interaction).then(() => true);
    }
    const topics = listMeetingTopics(interaction.guildId, meeting.id);
    await interaction.reply({ ...buildTopicManagementPayload(meeting, topics), flags: MessageFlags.Ephemeral });
    return true;
  }

  if (interaction.isModalSubmit() && ADMIN_MODAL_PREFIXES.some((prefix) => interaction.customId.startsWith(prefix))) {
    return handleEditModal({ client, interaction, meetings });
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith(MEETING_TOPIC_SELECT_PREFIX)) {
    const meetingId = interaction.customId.slice(MEETING_TOPIC_SELECT_PREFIX.length);
    const meeting = getMeetingById(meetings, meetingId);
    const topic = meeting ? getMeetingTopic(interaction.guildId, meetingId, interaction.values?.[0]) : null;
    if (!meeting || !topic) {
      await interaction.reply({ content: "Thema nicht gefunden.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.reply({ ...buildTopicActionsPayload(meeting, topic), flags: MessageFlags.Ephemeral });
    return true;
  }

  return handleTopicButtons({ interaction, meetings });
}

async function handleAddModal({ client, interaction, meetings }) {
  const name = interaction.fields.getTextInputValue(MEETING_ADMIN_NAME_INPUT)?.trim() || "";
  const announceChannelId = extractSnowflake(interaction.fields.getTextInputValue(MEETING_ADMIN_ANNOUNCE_INPUT));
  const voiceChannelId = extractSnowflake(interaction.fields.getTextInputValue(MEETING_ADMIN_VOICE_INPUT));
  const schedule = parseSchedule(interaction.fields.getTextInputValue(MEETING_ADMIN_SCHEDULE_INPUT));
  const intervalRaw = interaction.fields.getTextInputValue(MEETING_ADMIN_INTERVAL_INPUT)?.trim() || "1";
  const intervalWeeks = Math.max(1, Number.parseInt(intervalRaw, 10) || 1);

  if (!name || !announceChannelId || !schedule) {
    await interaction.reply({
      content: "Name, Ankündigungs-Channel und ein gültiger Termin (z. B. „Mittwoch 20:00“) sind erforderlich.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const id = createUniqueMeetingId(meetings, name);
  const updated = [
    ...meetings,
    {
      id,
      name,
      announceChannelId,
      voiceChannelId,
      intervalWeeks,
      weekday: schedule.weekday,
      hour: schedule.hour,
      minute: schedule.minute
    }
  ];

  saveMeetings(client, interaction.guildId, updated);

  await interaction.reply({
    content: `Meeting **${name}** (\`${id}\`) erstellt. Rollen und Vorlauf im Meeting-Menü einstellen.`,
    flags: MessageFlags.Ephemeral
  });
  return true;
}

async function handleEditModal({ client, interaction, meetings }) {
  const { customId } = interaction;

  if (customId.startsWith(MEETING_ADMIN_TIME_MODAL_PREFIX)) {
    const meetingId = customId.slice(MEETING_ADMIN_TIME_MODAL_PREFIX.length);
    const schedule = parseSchedule(interaction.fields.getTextInputValue(MEETING_ADMIN_SCHEDULE_INPUT));
    if (!schedule) {
      await interaction.reply({ content: "Ungültiger Termin. Beispiel: „Mittwoch 20:00“.", flags: MessageFlags.Ephemeral });
      return true;
    }

    const intervalWeeks = Math.max(1, Number.parseInt(interaction.fields.getTextInputValue(MEETING_ADMIN_INTERVAL_INPUT)?.trim() || "1", 10) || 1);
    const leadTimeHours = Math.max(1, Number.parseInt(interaction.fields.getTextInputValue(MEETING_ADMIN_LEAD_INPUT)?.trim() || "24", 10) || 24);

    const updated = meetings.map((meeting) => (
      meeting.id === meetingId
        ? { ...meeting, ...schedule, intervalWeeks, leadTimeHours }
        : meeting
    ));
    saveMeetings(client, interaction.guildId, updated);
    await interaction.reply({ content: "Termin aktualisiert.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const isOrganizer = customId.startsWith(MEETING_ADMIN_ORG_MODAL_PREFIX);
  const prefix = isOrganizer ? MEETING_ADMIN_ORG_MODAL_PREFIX : MEETING_ADMIN_ROLES_MODAL_PREFIX;
  const meetingId = customId.slice(prefix.length);
  const roleIds = parseRoleIds(interaction.fields.getTextInputValue(MEETING_ADMIN_ROLES_INPUT) || "");

  const updated = meetings.map((meeting) => {
    if (meeting.id !== meetingId) {
      return meeting;
    }
    return isOrganizer
      ? { ...meeting, organizerRoleIds: roleIds }
      : { ...meeting, participantRoleIds: roleIds };
  });
  saveMeetings(client, interaction.guildId, updated);

  await interaction.reply({
    content: isOrganizer ? "Organisator-Rollen aktualisiert." : "Teilnehmer-Rollen aktualisiert.",
    flags: MessageFlags.Ephemeral
  });
  return true;
}

async function handleTopicButtons({ interaction, meetings }) {
  if (!interaction.isButton()) {
    return false;
  }

  const buttonPrefixes = [
    { prefix: MEETING_TOPIC_UP_PREFIX, action: "up" },
    { prefix: MEETING_TOPIC_DOWN_PREFIX, action: "down" },
    { prefix: MEETING_TOPIC_STANDING_PREFIX, action: "standing" },
    { prefix: MEETING_TOPIC_DELETE_PREFIX, action: "delete" }
  ];

  const match = buttonPrefixes.find(({ prefix }) => interaction.customId.startsWith(prefix));
  if (!match) {
    return false;
  }

  const parsed = parseMeetingTopicCustomId(interaction.customId, match.prefix);
  const meeting = parsed ? getMeetingById(meetings, parsed.meetingId) : null;
  if (!meeting || !parsed) {
    await interaction.reply({ content: "Thema nicht gefunden.", flags: MessageFlags.Ephemeral });
    return true;
  }

  if (match.action === "delete") {
    removeMeetingTopic(interaction.guildId, meeting.id, parsed.topicId);
  } else if (match.action === "standing") {
    const topic = getMeetingTopic(interaction.guildId, meeting.id, parsed.topicId);
    setMeetingTopicStanding(interaction.guildId, meeting.id, parsed.topicId, !topic?.standing);
  } else {
    moveMeetingTopic(interaction.guildId, meeting.id, parsed.topicId, match.action);
  }

  const topics = listMeetingTopics(interaction.guildId, meeting.id);
  await interaction.update(buildTopicManagementPayload(meeting, topics));
  return true;
}
