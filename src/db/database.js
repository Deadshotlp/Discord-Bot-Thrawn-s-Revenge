import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const CREATE_GUILD_SETTINGS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT PRIMARY KEY,
  setup_channel_id TEXT,
  admin_category_id TEXT,
  welcome_channel_id TEXT,
  rules_channel_id TEXT,
  rules_message_id TEXT,
  rules_text TEXT,
  log_channel_id TEXT,
  log_member_channel_id TEXT,
  log_message_channel_id TEXT,
  log_voice_channel_id TEXT,
  bot_ping_channel_id TEXT,
  ticket_panel_channel_id TEXT,
  ticket_panel_message_id TEXT,
  support_waiting_voice_channel_id TEXT,
  verified_role_id TEXT,
  standard_team_role_id TEXT,
  ticket_counter INTEGER NOT NULL DEFAULT 0,
  departments_json TEXT,
  team_mod_role_id TEXT,
  team_dev_role_id TEXT,
  team_event_role_id TEXT,
  team_media_role_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

const REQUIRED_COLUMNS = [
  ["setup_channel_id", "TEXT"],
  ["admin_category_id", "TEXT"],
  ["welcome_channel_id", "TEXT"],
  ["rules_channel_id", "TEXT"],
  ["rules_message_id", "TEXT"],
  ["rules_text", "TEXT"],
  ["log_channel_id", "TEXT"],
  ["log_member_channel_id", "TEXT"],
  ["log_message_channel_id", "TEXT"],
  ["log_voice_channel_id", "TEXT"],
  ["bot_ping_channel_id", "TEXT"],
  ["ticket_panel_channel_id", "TEXT"],
  ["ticket_panel_message_id", "TEXT"],
  ["support_waiting_voice_channel_id", "TEXT"],
  ["verified_role_id", "TEXT"],
  ["standard_team_role_id", "TEXT"],
  ["ticket_counter", "INTEGER NOT NULL DEFAULT 0"],
  ["departments_json", "TEXT"],
  ["team_mod_role_id", "TEXT"],
  ["team_dev_role_id", "TEXT"],
  ["team_event_role_id", "TEXT"],
  ["team_media_role_id", "TEXT"],
  ["created_at", "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP"],
  ["updated_at", "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP"]
];

function ensureRequiredColumns(db) {
  const existingColumns = db
    .prepare("PRAGMA table_info(guild_settings)")
    .all()
    .map((column) => column.name);

  for (const [columnName, columnType] of REQUIRED_COLUMNS) {
    if (existingColumns.includes(columnName)) {
      continue;
    }

    db.exec(`ALTER TABLE guild_settings ADD COLUMN ${columnName} ${columnType}`);
  }
}

export function initDatabase() {
  const dataDir = path.join(process.cwd(), "data");
  fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, "bot.sqlite");
  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.exec(CREATE_GUILD_SETTINGS_TABLE_SQL);
  ensureRequiredColumns(db);

  return db;
}
