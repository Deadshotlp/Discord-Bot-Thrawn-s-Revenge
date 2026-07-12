import path from "node:path";
import Database from "better-sqlite3";
import { ensureDataDir } from "../../../core/dataDir.js";

const dbFilePath = path.join(ensureDataDir(), "meetings.db");

const db = new Database(dbFilePath);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS meeting_topics (
    guild_id TEXT NOT NULL,
    meeting_id TEXT NOT NULL,
    id TEXT NOT NULL,
    author_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    standing INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, meeting_id, id)
  );

  CREATE TABLE IF NOT EXISTS meeting_attendance (
    guild_id TEXT NOT NULL,
    meeting_id TEXT NOT NULL,
    occurrence_key TEXT NOT NULL,
    user_id TEXT NOT NULL,
    state TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, meeting_id, occurrence_key, user_id)
  );

  CREATE TABLE IF NOT EXISTS meeting_evaluations (
    guild_id TEXT NOT NULL,
    meeting_id TEXT NOT NULL,
    occurrence_key TEXT NOT NULL,
    present_ids TEXT NOT NULL DEFAULT '[]',
    excused_ids TEXT NOT NULL DEFAULT '[]',
    absent_ids TEXT NOT NULL DEFAULT '[]',
    evaluated_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, meeting_id, occurrence_key)
  );
`);

const insertTopicStmt = db.prepare(`
  INSERT INTO meeting_topics (guild_id, meeting_id, id, author_id, title, description, standing, sort_order, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const listTopicsStmt = db.prepare(`
  SELECT * FROM meeting_topics
  WHERE guild_id = ? AND meeting_id = ?
  ORDER BY sort_order ASC, created_at ASC
`);

const getTopicStmt = db.prepare(`
  SELECT * FROM meeting_topics
  WHERE guild_id = ? AND meeting_id = ? AND id = ?
  LIMIT 1
`);

const deleteTopicStmt = db.prepare(`
  DELETE FROM meeting_topics WHERE guild_id = ? AND meeting_id = ? AND id = ?
`);

const deleteConsumableTopicsStmt = db.prepare(`
  DELETE FROM meeting_topics WHERE guild_id = ? AND meeting_id = ? AND standing = 0
`);

const setTopicStandingStmt = db.prepare(`
  UPDATE meeting_topics SET standing = ? WHERE guild_id = ? AND meeting_id = ? AND id = ?
`);

const setTopicOrderStmt = db.prepare(`
  UPDATE meeting_topics SET sort_order = ? WHERE guild_id = ? AND meeting_id = ? AND id = ?
`);

const maxOrderStmt = db.prepare(`
  SELECT COALESCE(MAX(sort_order), 0) AS maxOrder FROM meeting_topics WHERE guild_id = ? AND meeting_id = ?
`);

const upsertAttendanceStmt = db.prepare(`
  INSERT INTO meeting_attendance (guild_id, meeting_id, occurrence_key, user_id, state, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT (guild_id, meeting_id, occurrence_key, user_id) DO UPDATE SET
    state = excluded.state,
    updated_at = excluded.updated_at
`);

const listAttendanceStmt = db.prepare(`
  SELECT user_id, state FROM meeting_attendance
  WHERE guild_id = ? AND meeting_id = ? AND occurrence_key = ?
`);

const upsertEvaluationStmt = db.prepare(`
  INSERT INTO meeting_evaluations (guild_id, meeting_id, occurrence_key, present_ids, excused_ids, absent_ids, evaluated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (guild_id, meeting_id, occurrence_key) DO UPDATE SET
    present_ids = excluded.present_ids,
    excused_ids = excluded.excused_ids,
    absent_ids = excluded.absent_ids,
    evaluated_at = excluded.evaluated_at
`);

function toTopic(row) {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    authorId: row.author_id,
    title: row.title,
    description: row.description || "",
    standing: Boolean(row.standing),
    sortOrder: Number(row.sort_order || 0),
    createdAt: Number(row.created_at || 0)
  };
}

function generateTopicId() {
  const random = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, "0");
  return `${Date.now().toString(36)}-${random}`;
}

export function addMeetingTopic({ guildId, meetingId, authorId, title, description }) {
  const id = generateTopicId();
  const nextOrder = Number(maxOrderStmt.get(guildId, meetingId)?.maxOrder || 0) + 1;
  insertTopicStmt.run(
    guildId,
    meetingId,
    id,
    authorId,
    String(title).slice(0, 200),
    String(description || "").slice(0, 1000),
    0,
    nextOrder,
    Date.now()
  );
  return toTopic(getTopicStmt.get(guildId, meetingId, id));
}

export function listMeetingTopics(guildId, meetingId) {
  return listTopicsStmt.all(guildId, meetingId).map(toTopic);
}

export function getMeetingTopic(guildId, meetingId, topicId) {
  const row = getTopicStmt.get(guildId, meetingId, topicId);
  return row ? toTopic(row) : null;
}

export function removeMeetingTopic(guildId, meetingId, topicId) {
  return deleteTopicStmt.run(guildId, meetingId, topicId).changes > 0;
}

export function consumeMeetingTopics(guildId, meetingId) {
  return deleteConsumableTopicsStmt.run(guildId, meetingId).changes;
}

export function setMeetingTopicStanding(guildId, meetingId, topicId, standing) {
  return setTopicStandingStmt.run(standing ? 1 : 0, guildId, meetingId, topicId).changes > 0;
}

// Verschiebt ein Thema in der Reihenfolge, indem es die sort_order mit dem
// benachbarten Thema tauscht.
export function moveMeetingTopic(guildId, meetingId, topicId, direction) {
  const topics = listMeetingTopics(guildId, meetingId);
  const index = topics.findIndex((topic) => topic.id === topicId);
  if (index < 0) {
    return false;
  }

  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= topics.length) {
    return false;
  }

  const current = topics[index];
  const neighbour = topics[swapIndex];

  const swap = db.transaction(() => {
    setTopicOrderStmt.run(neighbour.sortOrder, guildId, meetingId, current.id);
    setTopicOrderStmt.run(current.sortOrder, guildId, meetingId, neighbour.id);
  });
  swap();
  return true;
}

export function setMeetingAttendance({ guildId, meetingId, occurrenceKey, userId, state }) {
  upsertAttendanceStmt.run(guildId, meetingId, occurrenceKey, userId, state, Date.now());
}

export function listMeetingAttendance(guildId, meetingId, occurrenceKey) {
  return listAttendanceStmt.all(guildId, meetingId, occurrenceKey);
}

export function saveMeetingEvaluation({ guildId, meetingId, occurrenceKey, presentIds, excusedIds, absentIds }) {
  upsertEvaluationStmt.run(
    guildId,
    meetingId,
    occurrenceKey,
    JSON.stringify(presentIds),
    JSON.stringify(excusedIds),
    JSON.stringify(absentIds),
    Date.now()
  );
}

export function closeMeetingsDb() {
  if (db.open) {
    db.close();
  }
}
