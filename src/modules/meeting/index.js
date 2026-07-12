import { MessageFlags } from "discord.js";
import { isMeetingParticipant, normalizeMeetingModuleConfig } from "./services/config.js";
import { getMeetingById } from "./services/config.js";
import {
  getMostRecentOccurrence,
  getNextOccurrence,
  getOccurrenceKey
} from "./services/schedule.js";
import {
  buildAnnouncementPayload,
  buildEvaluationPayload,
  MEETING_DECLINE_PREFIX,
  MEETING_REGISTER_PREFIX,
  MEETING_TOPIC_ADD_PREFIX
} from "./services/agenda.js";
import {
  buildTopicModal,
  MEETING_TOPIC_DESC_INPUT_ID,
  MEETING_TOPIC_MODAL_PREFIX,
  MEETING_TOPIC_TITLE_INPUT_ID
} from "./services/topicModal.js";
import { evaluateAttendance } from "./services/evaluation.js";
import {
  addMeetingTopic,
  closeMeetingsDb,
  consumeMeetingTopics,
  listMeetingAttendance,
  listMeetingTopics,
  saveMeetingEvaluation,
  setMeetingAttendance
} from "./services/store.js";
import { handleMeetingAdminInteraction } from "./handlers/meetingAdminHandlers.js";
import { meetingCommand } from "./commands/meeting.js";
import { meetingAdminCommand } from "./commands/meetingAdmin.js";

const CHECK_INTERVAL_MS = 60 * 1000;
const EVALUATION_DELAY_MS = 5 * 60 * 1000;
const EVALUATION_WINDOW_MS = 15 * 60 * 1000;

const runtime = { timer: null, running: false };

function getMeetings(client, guildId) {
  const state = client.botContext.moduleConfigStore.getModuleState(guildId, "meeting");
  return normalizeMeetingModuleConfig(state?.config).meetings;
}

function patchMeeting(client, guildId, meetingId, patch) {
  const meetings = getMeetings(client, guildId).map((meeting) => (
    meeting.id === meetingId ? { ...meeting, ...patch } : meeting
  ));
  client.botContext.moduleConfigStore.setModuleConfig(guildId, "meeting", { meetings });
}

function readAttendanceLists(guildId, meetingId, occurrenceKey) {
  const attendance = listMeetingAttendance(guildId, meetingId, occurrenceKey);
  return {
    registeredIds: attendance.filter((entry) => entry.state === "registered").map((entry) => entry.user_id),
    declinedIds: attendance.filter((entry) => entry.state === "declined").map((entry) => entry.user_id)
  };
}

function buildLiveAnnouncement(guildId, meeting, occurrence) {
  const topics = listMeetingTopics(guildId, meeting.id);
  const { registeredIds, declinedIds } = readAttendanceLists(guildId, meeting.id, getOccurrenceKey(occurrence));
  return buildAnnouncementPayload({ meeting, occurrence, topics, registeredIds, declinedIds });
}

async function resolveTextChannel(guild, channelId) {
  if (!channelId) {
    return null;
  }
  return guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null));
}

async function postAnnouncement(client, guild, meeting, occurrence) {
  const channel = await resolveTextChannel(guild, meeting.announceChannelId);
  if (!channel?.isTextBased?.()) {
    return;
  }

  const message = await channel.send(buildLiveAnnouncement(guild.id, meeting, occurrence)).catch((error) => {
    client.botContext.logger.warn("Meeting: Ankündigung fehlgeschlagen", {
      guildId: guild.id,
      meetingId: meeting.id,
      error: String(error)
    });
    return null;
  });

  patchMeeting(client, guild.id, meeting.id, {
    lastAnnouncedKey: getOccurrenceKey(occurrence),
    announceMessageId: message?.id || "",
    announceMessageKey: message ? getOccurrenceKey(occurrence) : ""
  });
}

async function evaluateOccurrence(client, guild, meeting, occurrence) {
  const occurrenceKey = getOccurrenceKey(occurrence);
  const voiceChannel = meeting.voiceChannelId
    ? await resolveTextChannel(guild, meeting.voiceChannelId)
    : null;

  const voiceUserIds = [];
  if (voiceChannel?.members) {
    for (const member of voiceChannel.members.values()) {
      if (!member.user.bot && isMeetingParticipant(member, meeting)) {
        voiceUserIds.push(member.id);
      }
    }
  }

  const registrations = listMeetingAttendance(guild.id, meeting.id, occurrenceKey).map((entry) => ({
    userId: entry.user_id,
    state: entry.state
  }));

  const { presentIds, excusedIds, absentIds } = evaluateAttendance(registrations, voiceUserIds);

  saveMeetingEvaluation({ guildId: guild.id, meetingId: meeting.id, occurrenceKey, presentIds, excusedIds, absentIds });

  const channel = await resolveTextChannel(guild, meeting.announceChannelId);
  if (channel?.isTextBased?.()) {
    await channel
      .send(buildEvaluationPayload({ meeting, occurrence, presentIds, excusedIds, absentIds }))
      .catch((error) => {
        client.botContext.logger.warn("Meeting: Auswertung konnte nicht gepostet werden", {
          guildId: guild.id,
          meetingId: meeting.id,
          error: String(error)
        });
      });
  }

  consumeMeetingTopics(guild.id, meeting.id);
  patchMeeting(client, guild.id, meeting.id, { lastEvaluatedKey: occurrenceKey });

  client.botContext.logger.info("Meeting ausgewertet", {
    guildId: guild.id,
    meetingId: meeting.id,
    present: presentIds.length,
    excused: excusedIds.length,
    absent: absentIds.length
  });
}

async function processMeetingTick(client, guild, meeting, now) {
  if (!meeting.announceChannelId) {
    return;
  }

  const nextOccurrence = getNextOccurrence(now, meeting);
  if (nextOccurrence) {
    const occurrenceKey = getOccurrenceKey(nextOccurrence);
    const leadMs = meeting.leadTimeHours * 60 * 60 * 1000;
    if (meeting.lastAnnouncedKey !== occurrenceKey && now.getTime() >= nextOccurrence.getTime() - leadMs) {
      await postAnnouncement(client, guild, meeting, nextOccurrence);
    }
  }

  const recentOccurrence = getMostRecentOccurrence(now, meeting);
  if (recentOccurrence) {
    const occurrenceKey = getOccurrenceKey(recentOccurrence);
    const evaluateAt = recentOccurrence.getTime() + EVALUATION_DELAY_MS;
    const withinWindow = now.getTime() >= evaluateAt && now.getTime() <= evaluateAt + EVALUATION_WINDOW_MS;
    if (meeting.lastEvaluatedKey !== occurrenceKey && withinWindow) {
      await evaluateOccurrence(client, guild, meeting, recentOccurrence);
    }
  }
}

async function runMeetingCycle(client) {
  if (runtime.running) {
    return;
  }

  runtime.running = true;
  try {
    const now = new Date();
    for (const guild of client.guilds.cache.values()) {
      if (!client.botContext.moduleConfigStore.isModuleEnabled(guild.id, "meeting")) {
        continue;
      }

      for (const meeting of getMeetings(client, guild.id)) {
        await processMeetingTick(client, guild, meeting, now).catch((error) => {
          client.botContext.logger.warn("Meeting-Zyklus fehlgeschlagen", {
            guildId: guild.id,
            meetingId: meeting.id,
            error: String(error)
          });
        });
      }
    }
  } finally {
    runtime.running = false;
  }
}

async function handleMeetingReady({ client }) {
  if (runtime.timer) {
    return;
  }

  await runMeetingCycle(client);
  runtime.timer = setInterval(() => {
    runMeetingCycle(client).catch((error) => {
      client.botContext.logger.warn("Meeting-Zyklus fehlgeschlagen", { error: String(error) });
    });
  }, CHECK_INTERVAL_MS);
}

async function handleMeetingShutdown() {
  if (runtime.timer) {
    clearInterval(runtime.timer);
    runtime.timer = null;
  }
  closeMeetingsDb();
}

handleMeetingShutdown.alwaysAvailable = true;

async function refreshAnnouncementInPlace(interaction, meeting, occurrence) {
  await interaction.update(buildLiveAnnouncement(interaction.guildId, meeting, occurrence)).catch(() => null);
}

async function handleAttendanceButton({ client, interaction, meetingId, state }) {
  const meeting = getMeetingById(getMeetings(client, interaction.guildId), meetingId);
  if (!meeting) {
    await interaction.reply({ content: "Meeting nicht gefunden.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (!isMeetingParticipant(interaction.member, meeting)) {
    await interaction.reply({
      content: "Du gehörst nicht zu den Teilnehmer-Rollen dieses Meetings.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const nextOccurrence = getNextOccurrence(new Date(), meeting);
  if (!nextOccurrence) {
    await interaction.reply({ content: "Kein anstehender Termin.", flags: MessageFlags.Ephemeral });
    return;
  }

  setMeetingAttendance({
    guildId: interaction.guildId,
    meetingId: meeting.id,
    occurrenceKey: getOccurrenceKey(nextOccurrence),
    userId: interaction.user.id,
    state
  });

  await refreshAnnouncementInPlace(interaction, meeting, nextOccurrence);
}

async function handleTopicModalSubmit({ client, interaction }) {
  const meetingId = interaction.customId.slice(MEETING_TOPIC_MODAL_PREFIX.length);
  const meeting = getMeetingById(getMeetings(client, interaction.guildId), meetingId);
  if (!meeting) {
    await interaction.reply({ content: "Meeting nicht gefunden.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (!isMeetingParticipant(interaction.member, meeting)) {
    await interaction.reply({
      content: "Du gehörst nicht zu den Teilnehmer-Rollen dieses Meetings.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const title = interaction.fields.getTextInputValue(MEETING_TOPIC_TITLE_INPUT_ID)?.trim() || "";
  const description = interaction.fields.getTextInputValue(MEETING_TOPIC_DESC_INPUT_ID)?.trim() || "";

  if (!title) {
    await interaction.reply({ content: "Der Titel darf nicht leer sein.", flags: MessageFlags.Ephemeral });
    return;
  }

  addMeetingTopic({ guildId: interaction.guildId, meetingId: meeting.id, authorId: interaction.user.id, title, description });

  await interaction.reply({
    content: `Thema **${title}** wurde für **${meeting.name}** eingereicht.`,
    flags: MessageFlags.Ephemeral
  });
}

async function handleMeetingInteraction({ client, interaction }) {
  if (!interaction.inGuild()) {
    return;
  }

  const handledByAdmin = await handleMeetingAdminInteraction({ client, interaction });
  if (handledByAdmin) {
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith(MEETING_REGISTER_PREFIX)) {
    await handleAttendanceButton({
      client,
      interaction,
      meetingId: interaction.customId.slice(MEETING_REGISTER_PREFIX.length),
      state: "registered"
    });
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith(MEETING_DECLINE_PREFIX)) {
    await handleAttendanceButton({
      client,
      interaction,
      meetingId: interaction.customId.slice(MEETING_DECLINE_PREFIX.length),
      state: "declined"
    });
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith(MEETING_TOPIC_ADD_PREFIX)) {
    const meeting = getMeetingById(getMeetings(client, interaction.guildId), interaction.customId.slice(MEETING_TOPIC_ADD_PREFIX.length));
    if (!meeting) {
      await interaction.reply({ content: "Meeting nicht gefunden.", flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.showModal(buildTopicModal(meeting));
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith(MEETING_TOPIC_MODAL_PREFIX)) {
    await handleTopicModalSubmit({ client, interaction });
  }
}

handleMeetingInteraction.alwaysAvailable = true;

export const meetingModule = {
  name: "meeting",
  defaultEnabled: false,
  defaultConfig: {
    meetings: []
  },
  commands: [meetingCommand, meetingAdminCommand],
  events: {
    ready: [handleMeetingReady],
    interactionCreate: [handleMeetingInteraction],
    shutdown: [handleMeetingShutdown]
  }
};
