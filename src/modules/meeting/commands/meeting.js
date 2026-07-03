import { MessageFlags, SlashCommandBuilder } from "discord.js";
import {
  isMeetingParticipant,
  normalizeMeetingModuleConfig
} from "../services/config.js";
import { buildAgendaLines } from "../services/agenda.js";
import { buildTopicModal } from "../services/topicModal.js";
import { formatSchedule, getNextOccurrence, getOccurrenceKey } from "../services/schedule.js";
import {
  addMeetingTopic,
  listMeetingAttendance,
  listMeetingTopics,
  setMeetingAttendance
} from "../services/store.js";

export function getMeetingModuleConfig(client, guildId) {
  const state = client.botContext.moduleConfigStore.getModuleState(guildId, "meeting");
  return normalizeMeetingModuleConfig(state?.config);
}

// Löst das Meeting aus der Option auf; bei nur einem Meeting wird dieses genutzt.
export function resolveMeetingOption(meetings, requested) {
  const value = String(requested || "").trim().toLowerCase();
  if (!value) {
    return meetings.length === 1 ? meetings[0] : null;
  }

  return meetings.find(
    (meeting) => meeting.id.toLowerCase() === value || meeting.name.toLowerCase() === value
  ) || null;
}

async function replyNoMeeting(interaction, meetings) {
  if (meetings.length === 0) {
    await interaction.reply({
      content: "Es ist kein Meeting konfiguriert.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const list = meetings.map((meeting) => `- ${meeting.name} (\`${meeting.id}\`)`).join("\n");
  await interaction.reply({
    content: `Bitte ein Meeting angeben. Verfügbar:\n${list}`,
    flags: MessageFlags.Ephemeral
  });
}

async function setAttendance(client, interaction, state) {
  const { meetings } = getMeetingModuleConfig(client, interaction.guildId);
  const meeting = resolveMeetingOption(meetings, interaction.options.getString("meeting"));

  if (!meeting) {
    await replyNoMeeting(interaction, meetings);
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
    await interaction.reply({
      content: "Für dieses Meeting steht kein Termin an.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  setMeetingAttendance({
    guildId: interaction.guildId,
    meetingId: meeting.id,
    occurrenceKey: getOccurrenceKey(nextOccurrence),
    userId: interaction.user.id,
    state
  });

  const startTimestamp = Math.floor(nextOccurrence.getTime() / 1000);
  await interaction.reply({
    content: state === "registered"
      ? `Du bist für **${meeting.name}** am <t:${startTimestamp}:F> angemeldet.`
      : `Du bist für **${meeting.name}** am <t:${startTimestamp}:F> abgemeldet (entschuldigt).`,
    flags: MessageFlags.Ephemeral
  });
}

export const meetingCommand = {
  data: new SlashCommandBuilder()
    .setName("meeting")
    .setDescription("Regelmäßige Meetings: An-/Abmeldung, Status und Themen.")
    .addSubcommand((sub) => sub
      .setName("anmelden")
      .setDescription("Für den nächsten Termin anmelden.")
      .addStringOption((option) => option.setName("meeting").setDescription("Meeting (Name oder ID)").setRequired(false)))
    .addSubcommand((sub) => sub
      .setName("abmelden")
      .setDescription("Für den nächsten Termin abmelden (entschuldigt).")
      .addStringOption((option) => option.setName("meeting").setDescription("Meeting (Name oder ID)").setRequired(false)))
    .addSubcommand((sub) => sub
      .setName("status")
      .setDescription("Zeigt Termin, Agenda und An-/Abmeldungen.")
      .addStringOption((option) => option.setName("meeting").setDescription("Meeting (Name oder ID)").setRequired(false)))
    .addSubcommand((sub) => sub
      .setName("thema")
      .setDescription("Ein Thema für ein Meeting einreichen.")
      .addStringOption((option) => option.setName("meeting").setDescription("Meeting (Name oder ID)").setRequired(false))),

  async execute({ client, interaction }) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "Dieser Befehl funktioniert nur auf einem Server.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "anmelden") {
      await setAttendance(client, interaction, "registered");
      return;
    }

    if (subcommand === "abmelden") {
      await setAttendance(client, interaction, "declined");
      return;
    }

    const { meetings } = getMeetingModuleConfig(client, interaction.guildId);
    const meeting = resolveMeetingOption(meetings, interaction.options.getString("meeting"));

    if (!meeting) {
      await replyNoMeeting(interaction, meetings);
      return;
    }

    if (subcommand === "thema") {
      if (!isMeetingParticipant(interaction.member, meeting)) {
        await interaction.reply({
          content: "Du gehörst nicht zu den Teilnehmer-Rollen dieses Meetings.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      await interaction.showModal(buildTopicModal(meeting));
      return;
    }

    if (subcommand === "status") {
      const nextOccurrence = getNextOccurrence(new Date(), meeting);
      const topics = listMeetingTopics(interaction.guildId, meeting.id);

      let registeredCount = 0;
      let declinedCount = 0;
      if (nextOccurrence) {
        const attendance = listMeetingAttendance(interaction.guildId, meeting.id, getOccurrenceKey(nextOccurrence));
        registeredCount = attendance.filter((entry) => entry.state === "registered").length;
        declinedCount = attendance.filter((entry) => entry.state === "declined").length;
      }

      const startLine = nextOccurrence
        ? `**Nächster Termin:** <t:${Math.floor(nextOccurrence.getTime() / 1000)}:F>`
        : "**Nächster Termin:** _unbekannt_";

      await interaction.reply({
        content: [
          `**${meeting.name}** — ${formatSchedule(meeting)}`,
          startLine,
          `Angemeldet: ${registeredCount} · Abgemeldet: ${declinedCount}`,
          "",
          "**Agenda:**",
          buildAgendaLines(topics)
        ].join("\n").slice(0, 2000),
        flags: MessageFlags.Ephemeral
      });
    }
  }
};

// Exportiert für den Modal-Handler (Thema-Einreichung per Button und Command).
export function submitTopic({ guildId, meeting, authorId, title, description }) {
  return addMeetingTopic({
    guildId,
    meetingId: meeting.id,
    authorId,
    title,
    description
  });
}
