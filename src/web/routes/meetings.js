import { ACCESS_LEVELS, requireLevel } from "../auth.js";
import { HttpError, sendJson } from "../http.js";
import { recordAudit } from "../../core/audit.js";
import {
  createUniqueMeetingId,
  normalizeMeeting,
  normalizeMeetings
} from "../../modules/meeting/services/config.js";
import {
  formatSchedule,
  getMostRecentOccurrence,
  getNextOccurrence,
  getOccurrenceKey
} from "../../modules/meeting/services/schedule.js";
import {
  addMeetingTopic,
  listMeetingAttendance,
  listMeetingTopics,
  moveMeetingTopic,
  removeMeetingTopic,
  setMeetingTopicStanding
} from "../../modules/meeting/services/store.js";

function readMeetings(client, guildId) {
  const config = client.botContext.settingsStore.getModuleState(guildId, "meeting")?.config;
  return normalizeMeetings(config?.meetings);
}

function writeMeetings(client, guildId, meetings) {
  client.botContext.settingsStore.setModuleConfig(guildId, "meeting", { meetings });
}

function decorateMeeting(meeting) {
  const now = new Date();
  const next = getNextOccurrence(now, meeting);
  const previous = getMostRecentOccurrence(now, meeting);

  return {
    ...meeting,
    scheduleLabel: formatSchedule(meeting),
    nextOccurrence: next ? next.getTime() : null,
    nextOccurrenceKey: next ? getOccurrenceKey(next) : "",
    lastOccurrence: previous ? previous.getTime() : null,
    lastOccurrenceKey: previous ? getOccurrenceKey(previous) : ""
  };
}

export function registerMeetingRoutes(router, { client }) {
  router.get("/api/guilds/:guildId/meetings", (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.member);

    const meetings = readMeetings(client, ctx.params.guildId).map((meeting) => {
      const decorated = decorateMeeting(meeting);
      return {
        ...decorated,
        topics: listMeetingTopics(ctx.params.guildId, meeting.id),
        attendance: decorated.nextOccurrenceKey
          ? listMeetingAttendance(ctx.params.guildId, meeting.id, decorated.nextOccurrenceKey)
          : []
      };
    });

    sendJson(ctx.res, 200, meetings);
  });

  router.post("/api/guilds/:guildId/meetings", (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.lead);

    const meetings = readMeetings(client, ctx.params.guildId);
    const name = String(ctx.body.name || "").trim();

    if (!name) {
      throw new HttpError(400, "Name fehlt");
    }

    const meeting = normalizeMeeting({
      ...ctx.body,
      id: createUniqueMeetingId(meetings, name),
      name
    });

    if (!meeting) {
      throw new HttpError(400, "Meeting konnte nicht angelegt werden");
    }

    writeMeetings(client, ctx.params.guildId, [...meetings, meeting]);
    recordAudit({
      guildId: ctx.params.guildId,
      actorId: ctx.session.discordId,
      actorName: ctx.session.username,
      action: "meeting.create",
      detail: { meetingId: meeting.id, name }
    });

    sendJson(ctx.res, 201, decorateMeeting(meeting));
  });

  router.patch("/api/guilds/:guildId/meetings/:meetingId", (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.lead);

    const meetings = readMeetings(client, ctx.params.guildId);
    const index = meetings.findIndex((meeting) => meeting.id === ctx.params.meetingId);

    if (index === -1) {
      throw new HttpError(404, "Meeting nicht gefunden");
    }

    const merged = normalizeMeeting({ ...meetings[index], ...ctx.body, id: meetings[index].id });
    if (!merged) {
      throw new HttpError(400, "Ungültige Meeting-Daten");
    }

    meetings[index] = merged;
    writeMeetings(client, ctx.params.guildId, meetings);

    sendJson(ctx.res, 200, decorateMeeting(merged));
  });

  router.delete("/api/guilds/:guildId/meetings/:meetingId", (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.lead);

    const meetings = readMeetings(client, ctx.params.guildId)
      .filter((meeting) => meeting.id !== ctx.params.meetingId);

    writeMeetings(client, ctx.params.guildId, meetings);
    recordAudit({
      guildId: ctx.params.guildId,
      actorId: ctx.session.discordId,
      actorName: ctx.session.username,
      action: "meeting.delete",
      detail: { meetingId: ctx.params.meetingId }
    });

    sendJson(ctx.res, 200, { ok: true });
  });

  router.post("/api/guilds/:guildId/meetings/:meetingId/topics", (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.member);

    const title = String(ctx.body.title || "").trim();
    if (!title) {
      throw new HttpError(400, "Titel fehlt");
    }

    const topic = addMeetingTopic({
      guildId: ctx.params.guildId,
      meetingId: ctx.params.meetingId,
      authorId: ctx.session.discordId,
      title,
      description: ctx.body.description || ""
    });

    if (ctx.body.standing === true && ctx.access.level >= ACCESS_LEVELS.lead) {
      setMeetingTopicStanding(ctx.params.guildId, ctx.params.meetingId, topic.id, true);
      topic.standing = true;
    }

    sendJson(ctx.res, 201, topic);
  });

  router.patch("/api/guilds/:guildId/meetings/:meetingId/topics/:topicId", (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.lead);

    if (typeof ctx.body.standing === "boolean") {
      setMeetingTopicStanding(ctx.params.guildId, ctx.params.meetingId, ctx.params.topicId, ctx.body.standing);
    }

    if (ctx.body.move === "up" || ctx.body.move === "down") {
      moveMeetingTopic(ctx.params.guildId, ctx.params.meetingId, ctx.params.topicId, ctx.body.move);
    }

    sendJson(ctx.res, 200, listMeetingTopics(ctx.params.guildId, ctx.params.meetingId));
  });

  router.delete("/api/guilds/:guildId/meetings/:meetingId/topics/:topicId", (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.lead);
    removeMeetingTopic(ctx.params.guildId, ctx.params.meetingId, ctx.params.topicId);
    sendJson(ctx.res, 200, { ok: true });
  });
}
