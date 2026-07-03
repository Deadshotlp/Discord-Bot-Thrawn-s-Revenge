import { extractRoleIds } from "../../support/services/config.js";
import { getOccurrenceKey, parseAnchorDate } from "./schedule.js";

function safeString(value) {
  return String(value || "").trim();
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return fallback;
  }

  return parsed;
}

function slugifyName(name) {
  const slug = safeString(name)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);

  return slug || "meeting";
}

export function normalizeMeeting(rawMeeting) {
  if (!rawMeeting || typeof rawMeeting !== "object") {
    return null;
  }

  const name = safeString(rawMeeting.name);
  if (!name) {
    return null;
  }

  const id = safeString(rawMeeting.id) || slugifyName(name);
  const anchorDate = parseAnchorDate(rawMeeting.anchorDate)
    ? safeString(rawMeeting.anchorDate)
    : getOccurrenceKey(new Date());

  return {
    id,
    name,
    announceChannelId: safeString(rawMeeting.announceChannelId),
    voiceChannelId: safeString(rawMeeting.voiceChannelId),
    intervalWeeks: clampInteger(rawMeeting.intervalWeeks, 1, 52, 1),
    weekday: clampInteger(rawMeeting.weekday, 1, 7, 3),
    hour: clampInteger(rawMeeting.hour, 0, 23, 20),
    minute: clampInteger(rawMeeting.minute, 0, 59, 0),
    leadTimeHours: clampInteger(rawMeeting.leadTimeHours, 1, 336, 24),
    participantRoleIds: Array.isArray(rawMeeting.participantRoleIds)
      ? [...new Set(rawMeeting.participantRoleIds.map(safeString).filter(Boolean))]
      : [],
    organizerRoleIds: Array.isArray(rawMeeting.organizerRoleIds)
      ? [...new Set(rawMeeting.organizerRoleIds.map(safeString).filter(Boolean))]
      : [],
    anchorDate,
    lastAnnouncedKey: safeString(rawMeeting.lastAnnouncedKey),
    lastEvaluatedKey: safeString(rawMeeting.lastEvaluatedKey),
    announceMessageId: safeString(rawMeeting.announceMessageId),
    announceMessageKey: safeString(rawMeeting.announceMessageKey)
  };
}

export function normalizeMeetings(rawMeetings) {
  if (!Array.isArray(rawMeetings)) {
    return [];
  }

  const unique = new Map();
  for (const rawMeeting of rawMeetings) {
    const normalized = normalizeMeeting(rawMeeting);
    if (normalized && !unique.has(normalized.id)) {
      unique.set(normalized.id, normalized);
    }
  }

  return Array.from(unique.values());
}

export function normalizeMeetingModuleConfig(rawConfig) {
  const config = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  return {
    meetings: normalizeMeetings(config.meetings)
  };
}

export function getMeetingById(meetings, meetingId) {
  const targetId = safeString(meetingId);
  return normalizeMeetings(meetings).find((meeting) => meeting.id === targetId) || null;
}

export function createUniqueMeetingId(existingMeetings, name) {
  const existingIds = new Set(normalizeMeetings(existingMeetings).map((meeting) => meeting.id));
  const base = slugifyName(name);

  if (!existingIds.has(base)) {
    return base;
  }

  for (let index = 2; index < 999; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existingIds.has(candidate)) {
      return candidate;
    }
  }

  return `${base}-${Date.now().toString(36)}`;
}

export function parseRoleIds(raw) {
  return extractRoleIds(raw);
}

export function isMeetingOrganizer(member, meeting) {
  if (!member) {
    return false;
  }

  const organizerRoleIds = Array.isArray(meeting?.organizerRoleIds) ? meeting.organizerRoleIds : [];
  if (organizerRoleIds.length === 0) {
    return false;
  }

  return organizerRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

export function isMeetingParticipant(member, meeting) {
  if (!member) {
    return false;
  }

  const participantRoleIds = Array.isArray(meeting?.participantRoleIds) ? meeting.participantRoleIds : [];
  if (participantRoleIds.length === 0) {
    return true;
  }

  return participantRoleIds.some((roleId) => member.roles.cache.has(roleId));
}
