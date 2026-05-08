import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const dataDir = path.join(process.cwd(), "data");
const dbFilePath = path.join(dataDir, "support-tickets.db");

fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(dbFilePath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS support_tickets (
    guild_id TEXT NOT NULL,
    id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    department_id TEXT NOT NULL,
    ticket_name TEXT NOT NULL DEFAULT '',
    ticket_description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    closed_at INTEGER,
    closed_by_id TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (guild_id, id),
    UNIQUE (guild_id, channel_id)
  );

  CREATE INDEX IF NOT EXISTS idx_support_tickets_user_status
  ON support_tickets (guild_id, user_id, status, created_at DESC);
`);

const ticketColumns = db.prepare("PRAGMA table_info(support_tickets)").all();
const hasTicketNameColumn = ticketColumns.some((column) => column.name === "ticket_name");
const hasTicketDescriptionColumn = ticketColumns.some((column) => column.name === "ticket_description");

if (!hasTicketNameColumn) {
  db.exec("ALTER TABLE support_tickets ADD COLUMN ticket_name TEXT NOT NULL DEFAULT ''");
}

if (!hasTicketDescriptionColumn) {
  db.exec("ALTER TABLE support_tickets ADD COLUMN ticket_description TEXT NOT NULL DEFAULT ''");
}

const selectTicketByIdStmt = db.prepare(`
  SELECT *
  FROM support_tickets
  WHERE guild_id = ? AND id = ?
  LIMIT 1
`);

const selectOpenTicketByUserStmt = db.prepare(`
  SELECT *
  FROM support_tickets
  WHERE guild_id = ? AND user_id = ? AND status = 'open'
  ORDER BY created_at DESC
  LIMIT 1
`);

const insertTicketStmt = db.prepare(`
  INSERT INTO support_tickets (
    guild_id,
    id,
    channel_id,
    user_id,
    department_id,
    ticket_name,
    ticket_description,
    status,
    created_at,
    closed_at,
    closed_by_id
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const closeTicketStmt = db.prepare(`
  UPDATE support_tickets
  SET
    status = 'closed',
    closed_at = ?,
    closed_by_id = ?
  WHERE guild_id = ? AND id = ? AND status = 'open'
`);

const escalateTicketStmt = db.prepare(`
  UPDATE support_tickets
  SET
    department_id = ?
  WHERE guild_id = ? AND id = ? AND status = 'open'
`);

function toTicketData(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    userId: row.user_id,
    departmentId: row.department_id,
    ticketName: row.ticket_name || "",
    ticketDescription: row.ticket_description || "",
    status: row.status,
    createdAt: Number(row.created_at || 0),
    closedAt: row.closed_at ? Number(row.closed_at) : undefined,
    closedById: row.closed_by_id || ""
  };
}

function generateTicketId() {
  const random = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, "0");
  return `${Date.now().toString(36)}-${random}`;
}

const createTicketTransaction = db.transaction((
  guildId,
  channelId,
  userId,
  departmentId,
  ticketName,
  ticketDescription
) => {
  const existing = selectOpenTicketByUserStmt.get(guildId, userId);
  if (existing) {
    return { row: existing, created: false };
  }

  const createdAt = Date.now();
  const id = generateTicketId();

  insertTicketStmt.run(
    guildId,
    id,
    channelId,
    userId,
    departmentId,
    ticketName,
    ticketDescription,
    "open",
    createdAt,
    null,
    ""
  );

  return {
    row: selectTicketByIdStmt.get(guildId, id),
    created: true
  };
});

export function createSupportTicket({
  guildId,
  channelId,
  userId,
  departmentId,
  ticketName,
  ticketDescription
}) {
  const result = createTicketTransaction(
    guildId,
    channelId,
    userId,
    departmentId,
    String(ticketName || "").trim(),
    String(ticketDescription || "").trim()
  );
  return {
    ticket: toTicketData(result?.row || null),
    created: Boolean(result?.created)
  };
}

export function getSupportTicket(guildId, ticketId) {
  return toTicketData(selectTicketByIdStmt.get(guildId, ticketId));
}

export function getOpenTicketByUser(guildId, userId) {
  return toTicketData(selectOpenTicketByUserStmt.get(guildId, userId));
}

const closeTicketTransaction = db.transaction((guildId, ticketId, closedById) => {
  const existing = selectTicketByIdStmt.get(guildId, ticketId);
  if (!existing || existing.status !== "open") {
    return null;
  }

  const closedAt = Date.now();
  const result = closeTicketStmt.run(closedAt, closedById || "", guildId, ticketId);
  if (result.changes === 0) {
    return null;
  }

  return selectTicketByIdStmt.get(guildId, ticketId);
});

export function closeSupportTicket(guildId, ticketId, closedById) {
  return toTicketData(closeTicketTransaction(guildId, ticketId, closedById));
}

const escalateTicketTransaction = db.transaction((guildId, ticketId, departmentId) => {
  const existing = selectTicketByIdStmt.get(guildId, ticketId);
  if (!existing || existing.status !== "open") {
    return null;
  }

  const nextDepartmentId = String(departmentId || "").trim();
  if (!nextDepartmentId || existing.department_id === nextDepartmentId) {
    return existing;
  }

  const result = escalateTicketStmt.run(nextDepartmentId, guildId, ticketId);
  if (result.changes === 0) {
    return null;
  }

  return selectTicketByIdStmt.get(guildId, ticketId);
});

export function escalateSupportTicket(guildId, ticketId, departmentId) {
  return toTicketData(escalateTicketTransaction(guildId, ticketId, departmentId));
}
