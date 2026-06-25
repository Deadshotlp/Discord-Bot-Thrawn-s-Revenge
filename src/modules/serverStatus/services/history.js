import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const dataDir = path.join(process.cwd(), "data");
const dbFilePath = path.join(dataDir, "server-status-history.db");

fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(dbFilePath);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS server_status_snapshots (
    guild_id TEXT NOT NULL,
    taken_at INTEGER NOT NULL,
    online INTEGER NOT NULL,
    player_count INTEGER NOT NULL DEFAULT 0,
    max_players INTEGER NOT NULL DEFAULT 0,
    map TEXT NOT NULL DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS idx_server_status_snapshots_guild_time
  ON server_status_snapshots (guild_id, taken_at DESC);
`);

const insertSnapshotStmt = db.prepare(`
  INSERT INTO server_status_snapshots (guild_id, taken_at, online, player_count, max_players, map)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const selectSnapshotsSinceStmt = db.prepare(`
  SELECT taken_at, online, player_count, max_players, map
  FROM server_status_snapshots
  WHERE guild_id = ? AND taken_at >= ?
  ORDER BY taken_at ASC
`);

const deleteSnapshotsOlderThanStmt = db.prepare(`
  DELETE FROM server_status_snapshots
  WHERE guild_id = ? AND taken_at < ?
`);

function toSnapshot(row) {
  return {
    takenAt: Number(row.taken_at || 0),
    online: Boolean(row.online),
    playerCount: Number(row.player_count || 0),
    maxPlayers: Number(row.max_players || 0),
    map: row.map || ""
  };
}

export function recordServerStatusSnapshot({ guildId, online, playerCount, maxPlayers, map }) {
  const takenAt = Date.now();
  insertSnapshotStmt.run(
    guildId,
    takenAt,
    online ? 1 : 0,
    Number.isInteger(playerCount) ? playerCount : 0,
    Number.isInteger(maxPlayers) ? maxPlayers : 0,
    String(map || "")
  );
  return takenAt;
}

export function getServerStatusSnapshotsSince(guildId, sinceTimestamp) {
  return selectSnapshotsSinceStmt.all(guildId, sinceTimestamp).map(toSnapshot);
}

export function pruneServerStatusSnapshotsOlderThan(guildId, cutoffTimestamp) {
  const result = deleteSnapshotsOlderThanStmt.run(guildId, cutoffTimestamp);
  return result.changes;
}

export function buildDailyPlayerStats(snapshots, days = 7, now = Date.now()) {
  const dayMs = 24 * 60 * 60 * 1000;
  const buckets = [];

  for (let index = days - 1; index >= 0; index -= 1) {
    const dayStart = now - (index + 1) * dayMs;
    const dayEnd = now - index * dayMs;
    const dayLabel = new Intl.DateTimeFormat("de-DE", { weekday: "short" }).format(new Date(dayEnd - dayMs / 2));

    const daySnapshots = snapshots.filter((snapshot) => snapshot.takenAt >= dayStart && snapshot.takenAt < dayEnd);
    const onlineCounts = daySnapshots.filter((snapshot) => snapshot.online).map((snapshot) => snapshot.playerCount);

    const peak = onlineCounts.length > 0 ? Math.max(...onlineCounts) : 0;
    const average = onlineCounts.length > 0
      ? Math.round((onlineCounts.reduce((sum, value) => sum + value, 0) / onlineCounts.length) * 10) / 10
      : 0;

    buckets.push({ label: dayLabel, peak, average });
  }

  return buckets;
}
