import { db } from "./db.js";

const insertStmt = db.prepare(`
  INSERT INTO audit_log (guild_id, actor_id, actor_name, action, detail_json, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const listStmt = db.prepare(`
  SELECT * FROM audit_log
  WHERE guild_id = ?
  ORDER BY created_at DESC
  LIMIT ?
`);

export function recordAudit({ guildId = "", actorId = "", actorName = "", action, detail = {} }) {
  insertStmt.run(
    String(guildId || ""),
    String(actorId || ""),
    String(actorName || ""),
    String(action),
    JSON.stringify(detail ?? {}),
    Date.now()
  );
}

export function listAudit(guildId, limit = 100) {
  return listStmt.all(String(guildId), Math.min(500, Math.max(1, limit))).map((row) => ({
    id: Number(row.id),
    guildId: row.guild_id,
    actorId: row.actor_id,
    actorName: row.actor_name,
    action: row.action,
    detail: JSON.parse(row.detail_json || "{}"),
    createdAt: Number(row.created_at)
  }));
}
