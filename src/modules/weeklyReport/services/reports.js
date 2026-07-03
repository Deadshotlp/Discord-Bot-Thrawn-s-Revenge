import path from "node:path";
import Database from "better-sqlite3";
import { ensureDataDir } from "../../../core/dataDir.js";

const dbFilePath = path.join(ensureDataDir(), "weekly-reports.db");

const db = new Database(dbFilePath);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS weekly_reports (
    guild_id TEXT NOT NULL,
    week TEXT NOT NULL,
    department_id TEXT NOT NULL,
    author_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    published_at INTEGER,
    PRIMARY KEY (guild_id, week, department_id)
  );
`);

const upsertReportStmt = db.prepare(`
  INSERT INTO weekly_reports (guild_id, week, department_id, author_id, content, created_at, updated_at, published_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
  ON CONFLICT (guild_id, week, department_id) DO UPDATE SET
    author_id = excluded.author_id,
    content = excluded.content,
    updated_at = excluded.updated_at
`);

const selectReportStmt = db.prepare(`
  SELECT *
  FROM weekly_reports
  WHERE guild_id = ? AND week = ? AND department_id = ?
  LIMIT 1
`);

const selectReportsForWeekStmt = db.prepare(`
  SELECT *
  FROM weekly_reports
  WHERE guild_id = ? AND week = ?
  ORDER BY department_id ASC
`);

const deleteReportStmt = db.prepare(`
  DELETE FROM weekly_reports
  WHERE guild_id = ? AND week = ? AND department_id = ?
`);

const markWeekPublishedStmt = db.prepare(`
  UPDATE weekly_reports
  SET published_at = ?
  WHERE guild_id = ? AND week = ? AND published_at IS NULL
`);

const countUnpublishedForWeekStmt = db.prepare(`
  SELECT COUNT(*) AS count
  FROM weekly_reports
  WHERE guild_id = ? AND week = ? AND published_at IS NULL
`);

function toReportData(row) {
  if (!row) {
    return null;
  }

  return {
    guildId: row.guild_id,
    week: row.week,
    departmentId: row.department_id,
    authorId: row.author_id,
    content: row.content,
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
    publishedAt: row.published_at ? Number(row.published_at) : undefined
  };
}

export function upsertWeeklyReport({ guildId, week, departmentId, authorId, content }) {
  const now = Date.now();
  upsertReportStmt.run(guildId, week, departmentId, authorId, String(content || ""), now, now);
  return toReportData(selectReportStmt.get(guildId, week, departmentId));
}

export function getWeeklyReport(guildId, week, departmentId) {
  return toReportData(selectReportStmt.get(guildId, week, departmentId));
}

export function listWeeklyReportsForWeek(guildId, week) {
  return selectReportsForWeekStmt.all(guildId, week).map(toReportData);
}

export function deleteWeeklyReport(guildId, week, departmentId) {
  const result = deleteReportStmt.run(guildId, week, departmentId);
  return result.changes > 0;
}

export function markWeekPublished(guildId, week) {
  const result = markWeekPublishedStmt.run(Date.now(), guildId, week);
  return result.changes;
}

export function hasUnpublishedReports(guildId, week) {
  const row = countUnpublishedForWeekStmt.get(guildId, week);
  return Number(row?.count || 0) > 0;
}

export function closeWeeklyReportsDb() {
  if (db.open) {
    db.close();
  }
}
