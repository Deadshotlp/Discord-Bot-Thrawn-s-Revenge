import { db } from "./db.js";

// Team-Aktivität: welcher Supporter hat wie viele Tickets/Fälle bearbeitet.
// Wird von den Support-Handlern befüllt und im Dashboard ausgewertet.
export const STAFF_EVENT_KINDS = Object.freeze({
  ticketClosed: "ticket_closed",
  ticketEscalated: "ticket_escalated",
  ticketAnswered: "ticket_answered",
  caseClaimed: "case_claimed",
  caseClosed: "case_closed",
  caseEscalated: "case_escalated"
});

const insertStmt = db.prepare(`
  INSERT INTO staff_events (guild_id, user_id, kind, ref_id, department_id, created_at, meta_json)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const existsStmt = db.prepare(`
  SELECT 1 FROM staff_events
  WHERE guild_id = ? AND user_id = ? AND kind = ? AND ref_id = ?
  LIMIT 1
`);

const listSinceStmt = db.prepare(`
  SELECT * FROM staff_events
  WHERE guild_id = ? AND created_at >= ?
  ORDER BY created_at DESC
`);

const aggregateStmt = db.prepare(`
  SELECT user_id, kind, department_id, COUNT(*) AS total
  FROM staff_events
  WHERE guild_id = ? AND created_at >= ? AND created_at < ?
  GROUP BY user_id, kind, department_id
`);

const handlingTimeStmt = db.prepare(`
  SELECT user_id, AVG(json_extract(meta_json, '$.durationMs')) AS avg_ms, COUNT(*) AS total
  FROM staff_events
  WHERE guild_id = ? AND created_at >= ? AND created_at < ?
    AND json_extract(meta_json, '$.durationMs') IS NOT NULL
  GROUP BY user_id
`);

export function recordStaffEvent({ guildId, userId, kind, refId = "", departmentId = "", meta = {}, unique = true }) {
  if (!guildId || !userId || !kind) {
    return false;
  }

  if (unique && refId && existsStmt.get(guildId, userId, kind, refId)) {
    return false;
  }

  insertStmt.run(
    String(guildId),
    String(userId),
    String(kind),
    String(refId || ""),
    String(departmentId || ""),
    Date.now(),
    JSON.stringify(meta ?? {})
  );

  return true;
}

export function listStaffEventsSince(guildId, since) {
  return listSinceStmt.all(String(guildId), Number(since)).map((row) => ({
    id: Number(row.id),
    userId: row.user_id,
    kind: row.kind,
    refId: row.ref_id,
    departmentId: row.department_id,
    createdAt: Number(row.created_at),
    meta: JSON.parse(row.meta_json || "{}")
  }));
}

/**
 * Aggregierte Team-Statistik für ein Zeitfenster.
 * Liefert pro Nutzer die Zähler je Ereignisart plus eine gewichtete Gesamtzahl
 * "bearbeitet" (geschlossene Tickets + geclaimte Sprach-Fälle).
 */
export function buildTeamStats(guildId, { from, to = Date.now() } = {}) {
  const rows = aggregateStmt.all(String(guildId), Number(from || 0), Number(to));
  const byUser = new Map();

  for (const row of rows) {
    const userId = String(row.user_id);
    if (!byUser.has(userId)) {
      byUser.set(userId, {
        userId,
        handled: 0,
        ticketsClosed: 0,
        ticketsEscalated: 0,
        casesClaimed: 0,
        casesClosed: 0,
        departments: {}
      });
    }

    const entry = byUser.get(userId);
    const total = Number(row.total || 0);

    if (row.kind === STAFF_EVENT_KINDS.ticketClosed) {
      entry.ticketsClosed += total;
      entry.handled += total;
    } else if (row.kind === STAFF_EVENT_KINDS.ticketEscalated) {
      entry.ticketsEscalated += total;
    } else if (row.kind === STAFF_EVENT_KINDS.caseClaimed) {
      entry.casesClaimed += total;
      entry.handled += total;
    } else if (row.kind === STAFF_EVENT_KINDS.caseClosed) {
      entry.casesClosed += total;
    }

    if (row.department_id) {
      entry.departments[row.department_id] = (entry.departments[row.department_id] || 0) + total;
    }
  }

  for (const row of handlingTimeStmt.all(String(guildId), Number(from || 0), Number(to))) {
    const entry = byUser.get(String(row.user_id));
    if (entry) {
      entry.averageHandlingMs = Math.round(Number(row.avg_ms || 0));
    }
  }

  return [...byUser.values()].sort((a, b) => b.handled - a.handled);
}
