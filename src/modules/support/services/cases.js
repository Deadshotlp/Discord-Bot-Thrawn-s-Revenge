import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const dataDir = path.join(process.cwd(), "data");
const dbFilePath = path.join(dataDir, "support-cases.db");

fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(dbFilePath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS support_cases (
    guild_id TEXT NOT NULL,
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    department_id TEXT NOT NULL,
    waiting_channel_id TEXT NOT NULL,
    management_channel_id TEXT NOT NULL,
    management_message_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    supporter_id TEXT NOT NULL DEFAULT '',
    talk_channel_id TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    claimed_at INTEGER,
    closed_at INTEGER,
    actions_json TEXT NOT NULL,
    PRIMARY KEY (guild_id, id)
  );

  CREATE INDEX IF NOT EXISTS idx_support_cases_user_status
  ON support_cases (guild_id, user_id, status, created_at DESC);
`);

const selectCaseStmt = db.prepare(`
  SELECT *
  FROM support_cases
  WHERE guild_id = ? AND id = ?
  LIMIT 1
`);

const selectUserActiveCaseStmt = db.prepare(`
  SELECT *
  FROM support_cases
  WHERE guild_id = ? AND user_id = ? AND status != 'closed'
  ORDER BY created_at DESC
  LIMIT 1
`);

const insertCaseStmt = db.prepare(`
  INSERT INTO support_cases (
    guild_id,
    id,
    user_id,
    department_id,
    waiting_channel_id,
    management_channel_id,
    management_message_id,
    status,
    supporter_id,
    talk_channel_id,
    created_at,
    claimed_at,
    closed_at,
    actions_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateManagementMessageStmt = db.prepare(`
  UPDATE support_cases
  SET management_message_id = ?
  WHERE guild_id = ? AND id = ?
`);

const claimCaseStmt = db.prepare(`
  UPDATE support_cases
  SET
    status = 'claimed',
    supporter_id = ?,
    talk_channel_id = ?,
    claimed_at = ?,
    actions_json = ?
  WHERE guild_id = ? AND id = ? AND status = 'open'
`);

const escalateCaseStmt = db.prepare(`
  UPDATE support_cases
  SET
    department_id = ?,
    actions_json = ?
  WHERE guild_id = ? AND id = ? AND status != 'closed'
`);

const closeCaseStmt = db.prepare(`
  UPDATE support_cases
  SET
    status = 'closed',
    closed_at = ?,
    actions_json = ?
  WHERE guild_id = ? AND id = ? AND status != 'closed'
`);

const appendActionStmt = db.prepare(`
  UPDATE support_cases
  SET actions_json = ?
  WHERE guild_id = ? AND id = ?
`);

function parseActions(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toCaseData(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    guildId: row.guild_id,
    userId: row.user_id,
    departmentId: row.department_id,
    waitingChannelId: row.waiting_channel_id,
    managementChannelId: row.management_channel_id,
    managementMessageId: row.management_message_id || "",
    status: row.status,
    supporterId: row.supporter_id || "",
    talkChannelId: row.talk_channel_id || "",
    createdAt: Number(row.created_at || 0),
    claimedAt: row.claimed_at ? Number(row.claimed_at) : undefined,
    closedAt: row.closed_at ? Number(row.closed_at) : undefined,
    actions: parseActions(row.actions_json)
  };
}

function appendActionToJson(actionsJson, text, at = Date.now()) {
  const actions = parseActions(actionsJson);
  actions.push({
    at,
    text: String(text || "")
  });
  return JSON.stringify(actions);
}

function generateCaseId() {
  const random = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, "0");
  return `${Date.now().toString(36)}-${random}`;
}

export function createSupportCase({ guildId, userId, departmentId, waitingChannelId, managementChannelId }) {
  const existingCase = toCaseData(selectUserActiveCaseStmt.get(guildId, userId));
  if (existingCase) {
    return { caseData: existingCase, created: false };
  }

  const now = Date.now();
  const id = generateCaseId();
  const initialActions = JSON.stringify([{
    at: now,
    text: `Fall erstellt. Department: ${departmentId}`
  }]);

  insertCaseStmt.run(
    guildId,
    id,
    userId,
    departmentId,
    waitingChannelId,
    managementChannelId,
    "",
    "open",
    "",
    "",
    now,
    null,
    null,
    initialActions
  );

  const caseData = toCaseData(selectCaseStmt.get(guildId, id));
  return { caseData, created: true };
}

export function getSupportCase(guildId, caseId) {
  return toCaseData(selectCaseStmt.get(guildId, caseId));
}

export function getUserActiveCase(guildId, userId) {
  return toCaseData(selectUserActiveCaseStmt.get(guildId, userId));
}

export function setCaseManagementMessage(guildId, caseId, messageId) {
  const existing = getSupportCase(guildId, caseId);
  if (!existing) {
    return null;
  }

  updateManagementMessageStmt.run(messageId || "", guildId, caseId);
  return getSupportCase(guildId, caseId);
}

const claimCaseTransaction = db.transaction((guildId, caseId, supporterId, talkChannelId) => {
  const existing = selectCaseStmt.get(guildId, caseId);
  if (!existing || existing.status !== "open") {
    return null;
  }

  const claimedAt = Date.now();
  const actionsJson = appendActionToJson(
    existing.actions_json,
    `Fall geclaimed von ${supporterId}. Talk-Channel: ${talkChannelId}`,
    claimedAt
  );

  const result = claimCaseStmt.run(
    supporterId,
    talkChannelId,
    claimedAt,
    actionsJson,
    guildId,
    caseId
  );

  if (result.changes === 0) {
    return null;
  }

  return selectCaseStmt.get(guildId, caseId);
});

export function claimSupportCase(guildId, caseId, supporterId, talkChannelId) {
  const row = claimCaseTransaction(guildId, caseId, supporterId, talkChannelId);
  return toCaseData(row);
}

const escalateCaseTransaction = db.transaction((guildId, caseId, departmentId, escalatedById) => {
  const existing = selectCaseStmt.get(guildId, caseId);
  if (!existing || existing.status === "closed") {
    return null;
  }

  const actionsJson = appendActionToJson(
    existing.actions_json,
    `Fall eskaliert von ${escalatedById} auf Department ${departmentId}`
  );

  const result = escalateCaseStmt.run(departmentId, actionsJson, guildId, caseId);
  if (result.changes === 0) {
    return null;
  }

  return selectCaseStmt.get(guildId, caseId);
});

export function escalateSupportCase(guildId, caseId, departmentId, escalatedById) {
  const row = escalateCaseTransaction(guildId, caseId, departmentId, escalatedById);
  return toCaseData(row);
}

const closeCaseTransaction = db.transaction((guildId, caseId, closedById) => {
  const existing = selectCaseStmt.get(guildId, caseId);
  if (!existing || existing.status === "closed") {
    return null;
  }

  const closedAt = Date.now();
  const actionsJson = appendActionToJson(existing.actions_json, `Fall geschlossen von ${closedById}`, closedAt);

  const result = closeCaseStmt.run(closedAt, actionsJson, guildId, caseId);
  if (result.changes === 0) {
    return null;
  }

  return selectCaseStmt.get(guildId, caseId);
});

export function closeSupportCase(guildId, caseId, closedById) {
  const row = closeCaseTransaction(guildId, caseId, closedById);
  return toCaseData(row);
}

const appendActionTransaction = db.transaction((guildId, caseId, text) => {
  const existing = selectCaseStmt.get(guildId, caseId);
  if (!existing) {
    return null;
  }

  const actionsJson = appendActionToJson(existing.actions_json, text);
  appendActionStmt.run(actionsJson, guildId, caseId);
  return selectCaseStmt.get(guildId, caseId);
});

export function addSupportCaseAction(guildId, caseId, text) {
  const row = appendActionTransaction(guildId, caseId, text);
  return toCaseData(row);
}
