import { db } from "../../../core/db.js";
import { createId } from "../../../core/ids.js";

export const ABSENCE_KINDS = Object.freeze({
  urlaub: { id: "urlaub", label: "Urlaub", emoji: "🌴" },
  krank: { id: "krank", label: "Krank", emoji: "🤒" },
  abwesend: { id: "abwesend", label: "Abwesend", emoji: "🚫" },
  eingeschraenkt: { id: "eingeschraenkt", label: "Eingeschränkt erreichbar", emoji: "🕒" },
  pruefung: { id: "pruefung", label: "Prüfung / Schule", emoji: "📚" }
});

export const ABSENCE_STATUS = Object.freeze({
  pending: "pending",
  active: "active",
  rejected: "rejected",
  cancelled: "cancelled"
});

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function toIsoDate(value) {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  const text = String(value || "").trim();
  if (DATE_PATTERN.test(text)) {
    return text;
  }

  // Deutsche Schreibweisen: 24.12.2026, 24.12., 24.12.26
  const german = text.match(/^(\d{1,2})\.(\d{1,2})\.?(\d{2,4})?$/);
  if (german) {
    const day = String(Number(german[1])).padStart(2, "0");
    const month = String(Number(german[2])).padStart(2, "0");
    let year = german[3] ? Number(german[3]) : new Date().getFullYear();
    if (year < 100) {
      year += 2000;
    }

    return `${year}-${month}-${day}`;
  }

  return "";
}

export function isValidDate(isoDate) {
  if (!DATE_PATTERN.test(isoDate)) {
    return false;
  }

  const date = new Date(`${isoDate}T12:00:00`);
  return !Number.isNaN(date.getTime()) && toIsoDate(date) === isoDate;
}

export function todayIso(now = new Date()) {
  return toIsoDate(now);
}

export function daysBetween(fromIso, toIsoValue) {
  const from = new Date(`${fromIso}T12:00:00`).getTime();
  const to = new Date(`${toIsoValue}T12:00:00`).getTime();
  return Math.round((to - from) / (24 * 60 * 60 * 1000)) + 1;
}

const insertStmt = db.prepare(`
  INSERT INTO absences (
    id, guild_id, user_id, department_ids, starts_on, ends_on, kind, reason,
    status, created_at, created_by, updated_at, announce_message_id, notified_start, notified_end
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 0, 0)
`);

const selectByIdStmt = db.prepare("SELECT * FROM absences WHERE id = ?");

const selectByGuildStmt = db.prepare(`
  SELECT * FROM absences
  WHERE guild_id = ?
  ORDER BY starts_on ASC, created_at ASC
`);

const selectActiveRangeStmt = db.prepare(`
  SELECT * FROM absences
  WHERE guild_id = ? AND status IN ('active', 'pending')
    AND ends_on >= ? AND starts_on <= ?
  ORDER BY starts_on ASC
`);

const selectUserStmt = db.prepare(`
  SELECT * FROM absences
  WHERE guild_id = ? AND user_id = ? AND status IN ('active', 'pending')
    AND ends_on >= ?
  ORDER BY starts_on ASC
`);

const updateStatusStmt = db.prepare(
  "UPDATE absences SET status = ?, updated_at = ? WHERE id = ?"
);

const updateStmt = db.prepare(`
  UPDATE absences
  SET department_ids = ?, starts_on = ?, ends_on = ?, kind = ?, reason = ?, updated_at = ?
  WHERE id = ?
`);

const setAnnounceMessageStmt = db.prepare(
  "UPDATE absences SET announce_message_id = ? WHERE id = ?"
);

const setNotifiedStmt = db.prepare(
  "UPDATE absences SET notified_start = ?, notified_end = ? WHERE id = ?"
);

const deleteStmt = db.prepare("DELETE FROM absences WHERE id = ?");

function toAbsence(row) {
  if (!row) {
    return null;
  }

  let departmentIds;
  try {
    const parsed = JSON.parse(row.department_ids || "[]");
    departmentIds = Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    departmentIds = [];
  }

  return {
    id: row.id,
    guildId: row.guild_id,
    userId: row.user_id,
    departmentIds,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    kind: row.kind,
    reason: row.reason || "",
    status: row.status,
    createdAt: Number(row.created_at || 0),
    createdBy: row.created_by || "",
    updatedAt: Number(row.updated_at || 0),
    announceMessageId: row.announce_message_id || "",
    notifiedStart: Boolean(row.notified_start),
    notifiedEnd: Boolean(row.notified_end),
    days: daysBetween(row.starts_on, row.ends_on)
  };
}

export function createAbsence({
  guildId,
  userId,
  departmentIds = [],
  startsOn,
  endsOn,
  kind = "abwesend",
  reason = "",
  status = ABSENCE_STATUS.active,
  createdBy = ""
}) {
  const start = toIsoDate(startsOn);
  const end = toIsoDate(endsOn) || start;

  if (!isValidDate(start) || !isValidDate(end)) {
    throw new Error("Ungültiges Datum. Format: TT.MM.JJJJ oder JJJJ-MM-TT.");
  }

  if (end < start) {
    throw new Error("Das Enddatum liegt vor dem Startdatum.");
  }

  const id = createId("abs");
  insertStmt.run(
    id,
    String(guildId),
    String(userId),
    JSON.stringify([...new Set(departmentIds.map(String).filter(Boolean))]),
    start,
    end,
    ABSENCE_KINDS[kind] ? kind : "abwesend",
    String(reason || "").slice(0, 500),
    status,
    Date.now(),
    String(createdBy || userId),
    Date.now()
  );

  return getAbsence(id);
}

export function getAbsence(id) {
  return toAbsence(selectByIdStmt.get(String(id)));
}

export function listAbsences(guildId) {
  return selectByGuildStmt.all(String(guildId)).map(toAbsence);
}

// Alle Abmeldungen, die sich mit dem Zeitfenster überschneiden.
export function listAbsencesInRange(guildId, fromIso, toIsoValue) {
  return selectActiveRangeStmt.all(String(guildId), fromIso, toIsoValue).map(toAbsence);
}

export function listCurrentAbsences(guildId, referenceIso = todayIso()) {
  return listAbsencesInRange(guildId, referenceIso, referenceIso)
    .filter((absence) => absence.status === ABSENCE_STATUS.active);
}

export function listUpcomingAbsences(guildId, days = 21, referenceIso = todayIso()) {
  const until = new Date(`${referenceIso}T12:00:00`);
  until.setDate(until.getDate() + days);
  return listAbsencesInRange(guildId, referenceIso, toIsoDate(until));
}

export function listUserAbsences(guildId, userId, referenceIso = todayIso()) {
  return selectUserStmt.all(String(guildId), String(userId), referenceIso).map(toAbsence);
}

export function updateAbsence(id, patch) {
  const existing = getAbsence(id);
  if (!existing) {
    return null;
  }

  const start = patch.startsOn === undefined ? existing.startsOn : toIsoDate(patch.startsOn);
  const end = patch.endsOn === undefined ? existing.endsOn : toIsoDate(patch.endsOn);

  if (!isValidDate(start) || !isValidDate(end)) {
    throw new Error("Ungültiges Datum.");
  }

  if (end < start) {
    throw new Error("Das Enddatum liegt vor dem Startdatum.");
  }

  updateStmt.run(
    JSON.stringify(
      patch.departmentIds === undefined
        ? existing.departmentIds
        : [...new Set(patch.departmentIds.map(String).filter(Boolean))]
    ),
    start,
    end,
    ABSENCE_KINDS[patch.kind] ? patch.kind : existing.kind,
    patch.reason === undefined ? existing.reason : String(patch.reason).slice(0, 500),
    Date.now(),
    existing.id
  );

  return getAbsence(existing.id);
}

export function setAbsenceStatus(id, status) {
  if (!Object.values(ABSENCE_STATUS).includes(status)) {
    return null;
  }

  updateStatusStmt.run(status, Date.now(), String(id));
  return getAbsence(id);
}

export function setAbsenceAnnounceMessage(id, messageId) {
  setAnnounceMessageStmt.run(String(messageId || ""), String(id));
}

export function setAbsenceNotified(id, { start, end }) {
  const existing = getAbsence(id);
  if (!existing) {
    return;
  }

  setNotifiedStmt.run(
    start === undefined ? (existing.notifiedStart ? 1 : 0) : (start ? 1 : 0),
    end === undefined ? (existing.notifiedEnd ? 1 : 0) : (end ? 1 : 0),
    String(id)
  );
}

export function deleteAbsence(id) {
  return deleteStmt.run(String(id)).changes > 0;
}

/**
 * Gruppiert Abmeldungen nach Department. Einträge ohne Department landen
 * unter dem Schlüssel "" (allgemein).
 */
export function groupByDepartment(absences) {
  const grouped = new Map();

  for (const absence of absences) {
    const keys = absence.departmentIds.length > 0 ? absence.departmentIds : [""];
    for (const key of keys) {
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }

      grouped.get(key).push(absence);
    }
  }

  return grouped;
}
