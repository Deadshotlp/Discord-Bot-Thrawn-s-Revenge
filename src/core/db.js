import path from "node:path";
import Database from "better-sqlite3";
import { ensureDataDir } from "./dataDir.js";

// Zentrale Datenbank für Kern-Zustand: Modul-Einstellungen, Monitoring,
// Abmeldungen, Steam-Verknüpfungen, Web-Sessions und Team-Statistiken.
// Ältere fachspezifische Datenbanken (Tickets, Fälle, Meetings, Wochenberichte)
// bleiben in eigenen Dateien, damit vorhandene Daten erhalten bleiben.
const dbFilePath = path.join(ensureDataDir(), "bot.db");

export const db = new Database(dbFilePath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  );
`);

const migrations = [
  {
    id: 1,
    name: "core-tables",
    up() {
      db.exec(`
        CREATE TABLE IF NOT EXISTS guild_modules (
          guild_id TEXT NOT NULL,
          module TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          config_json TEXT NOT NULL DEFAULT '{}',
          updated_at INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (guild_id, module)
        );

        CREATE TABLE IF NOT EXISTS monitor_servers (
          id TEXT PRIMARY KEY,
          guild_id TEXT NOT NULL,
          name TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'source',
          host TEXT NOT NULL,
          port INTEGER NOT NULL DEFAULT 27015,
          query_port INTEGER,
          enabled INTEGER NOT NULL DEFAULT 1,
          interval_seconds INTEGER NOT NULL DEFAULT 30,
          connect_url TEXT NOT NULL DEFAULT '',
          color TEXT NOT NULL DEFAULT '#5865f2',
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          created_by TEXT NOT NULL DEFAULT '',
          meta_json TEXT NOT NULL DEFAULT '{}'
        );

        CREATE INDEX IF NOT EXISTS idx_monitor_servers_guild
        ON monitor_servers (guild_id, sort_order, created_at);

        CREATE TABLE IF NOT EXISTS monitor_samples (
          server_id TEXT NOT NULL,
          taken_at INTEGER NOT NULL,
          online INTEGER NOT NULL DEFAULT 0,
          players INTEGER NOT NULL DEFAULT 0,
          max_players INTEGER NOT NULL DEFAULT 0,
          bots INTEGER NOT NULL DEFAULT 0,
          map TEXT NOT NULL DEFAULT '',
          latency_ms INTEGER NOT NULL DEFAULT 0,
          version TEXT NOT NULL DEFAULT ''
        );

        CREATE INDEX IF NOT EXISTS idx_monitor_samples_server_time
        ON monitor_samples (server_id, taken_at DESC);

        CREATE TABLE IF NOT EXISTS monitor_rollups (
          server_id TEXT NOT NULL,
          bucket TEXT NOT NULL,
          bucket_start INTEGER NOT NULL,
          samples INTEGER NOT NULL DEFAULT 0,
          online_samples INTEGER NOT NULL DEFAULT 0,
          players_sum INTEGER NOT NULL DEFAULT 0,
          players_peak INTEGER NOT NULL DEFAULT 0,
          players_min INTEGER NOT NULL DEFAULT 0,
          max_players INTEGER NOT NULL DEFAULT 0,
          latency_sum INTEGER NOT NULL DEFAULT 0,
          top_map TEXT NOT NULL DEFAULT '',
          PRIMARY KEY (server_id, bucket, bucket_start)
        );

        CREATE TABLE IF NOT EXISTS monitor_player_samples (
          server_id TEXT NOT NULL,
          taken_at INTEGER NOT NULL,
          steam_id TEXT NOT NULL DEFAULT '',
          name TEXT NOT NULL DEFAULT '',
          score INTEGER NOT NULL DEFAULT 0,
          duration_seconds INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_monitor_player_samples_server_time
        ON monitor_player_samples (server_id, taken_at DESC);

        CREATE TABLE IF NOT EXISTS play_sessions (
          id TEXT PRIMARY KEY,
          server_id TEXT NOT NULL,
          steam_id TEXT NOT NULL DEFAULT '',
          name TEXT NOT NULL DEFAULT '',
          started_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          ended_at INTEGER,
          seconds INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_play_sessions_open
        ON play_sessions (server_id, steam_id, ended_at);

        CREATE INDEX IF NOT EXISTS idx_play_sessions_steam
        ON play_sessions (steam_id, started_at DESC);

        CREATE TABLE IF NOT EXISTS steam_links (
          guild_id TEXT NOT NULL,
          discord_id TEXT NOT NULL,
          steam_id TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'code',
          verified_at INTEGER NOT NULL,
          PRIMARY KEY (guild_id, discord_id)
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_steam_links_unique_steam
        ON steam_links (guild_id, steam_id);

        CREATE TABLE IF NOT EXISTS steam_link_codes (
          code TEXT PRIMARY KEY,
          guild_id TEXT NOT NULL,
          discord_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS absences (
          id TEXT PRIMARY KEY,
          guild_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          department_ids TEXT NOT NULL DEFAULT '[]',
          starts_on TEXT NOT NULL,
          ends_on TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'abwesend',
          reason TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'active',
          created_at INTEGER NOT NULL,
          created_by TEXT NOT NULL DEFAULT '',
          updated_at INTEGER NOT NULL DEFAULT 0,
          announce_message_id TEXT NOT NULL DEFAULT '',
          notified_start INTEGER NOT NULL DEFAULT 0,
          notified_end INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_absences_guild_range
        ON absences (guild_id, status, starts_on, ends_on);

        CREATE TABLE IF NOT EXISTS staff_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          guild_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          ref_id TEXT NOT NULL DEFAULT '',
          department_id TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          meta_json TEXT NOT NULL DEFAULT '{}'
        );

        CREATE INDEX IF NOT EXISTS idx_staff_events_guild_time
        ON staff_events (guild_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_staff_events_user
        ON staff_events (guild_id, user_id, kind, created_at DESC);

        CREATE TABLE IF NOT EXISTS web_sessions (
          id TEXT PRIMARY KEY,
          discord_id TEXT NOT NULL,
          username TEXT NOT NULL DEFAULT '',
          display_name TEXT NOT NULL DEFAULT '',
          avatar TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          data_json TEXT NOT NULL DEFAULT '{}'
        );

        CREATE TABLE IF NOT EXISTS ingest_tokens (
          token TEXT PRIMARY KEY,
          guild_id TEXT NOT NULL,
          server_id TEXT NOT NULL,
          label TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          last_used_at INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          guild_id TEXT NOT NULL DEFAULT '',
          actor_id TEXT NOT NULL DEFAULT '',
          actor_name TEXT NOT NULL DEFAULT '',
          action TEXT NOT NULL,
          detail_json TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_audit_log_guild_time
        ON audit_log (guild_id, created_at DESC);
      `);
    }
  }
];

function runMigrations() {
  const applied = new Set(
    db.prepare("SELECT id FROM schema_migrations").all().map((row) => Number(row.id))
  );

  const insertMigration = db.prepare(
    "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)"
  );

  for (const migration of migrations) {
    if (applied.has(migration.id)) {
      continue;
    }

    const apply = db.transaction(() => {
      migration.up();
      insertMigration.run(migration.id, Date.now());
    });

    apply();
  }
}

runMigrations();

export function closeDb() {
  if (db.open) {
    db.close();
  }
}
