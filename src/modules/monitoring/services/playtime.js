import { db } from "../../../core/db.js";
import { createId } from "../../../core/ids.js";

// Spielzeit-Sessions. Identität ist die SteamID, wenn der Server sie liefert
// (FiveM-Identifier oder Gmod-Ingest-Addon). Sonst dient der Spielername als
// Ersatzschlüssel mit Präfix "name:", damit beide Welten nicht kollidieren.
const SESSION_GRACE_MS = 5 * 60 * 1000;

const insertPlayerSampleStmt = db.prepare(`
  INSERT INTO monitor_player_samples (server_id, taken_at, steam_id, name, score, duration_seconds)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const selectOpenSessionsStmt = db.prepare(`
  SELECT * FROM play_sessions
  WHERE server_id = ? AND ended_at IS NULL
`);

const insertSessionStmt = db.prepare(`
  INSERT INTO play_sessions (id, server_id, steam_id, name, started_at, last_seen_at, ended_at, seconds)
  VALUES (?, ?, ?, ?, ?, ?, NULL, 0)
`);

const touchSessionStmt = db.prepare(`
  UPDATE play_sessions
  SET last_seen_at = ?, seconds = ?, name = ?
  WHERE id = ?
`);

const closeSessionStmt = db.prepare(`
  UPDATE play_sessions
  SET ended_at = ?, seconds = ?
  WHERE id = ?
`);

const playtimeBySteamStmt = db.prepare(`
  SELECT SUM(seconds) AS seconds, COUNT(*) AS sessions, MAX(last_seen_at) AS last_seen
  FROM play_sessions
  WHERE steam_id = ? AND started_at >= ?
`);

const playtimeBySteamAndServerStmt = db.prepare(`
  SELECT server_id, SUM(seconds) AS seconds, COUNT(*) AS sessions, MAX(last_seen_at) AS last_seen
  FROM play_sessions
  WHERE steam_id = ? AND started_at >= ?
  GROUP BY server_id
`);

const topPlayersStmt = db.prepare(`
  SELECT steam_id, name, SUM(seconds) AS seconds, COUNT(*) AS sessions, MAX(last_seen_at) AS last_seen
  FROM play_sessions
  WHERE server_id = ? AND started_at >= ? AND steam_id != ''
  GROUP BY steam_id
  ORDER BY seconds DESC
  LIMIT ?
`);

const uniquePlayersStmt = db.prepare(`
  SELECT COUNT(DISTINCT CASE WHEN steam_id != '' THEN steam_id ELSE 'name:' || name END) AS total
  FROM play_sessions
  WHERE server_id = ? AND started_at >= ?
`);

const recentSessionsStmt = db.prepare(`
  SELECT * FROM play_sessions
  WHERE steam_id = ?
  ORDER BY started_at DESC
  LIMIT ?
`);

function identityKey(player) {
  const steamId = String(player?.steamId || "").trim();
  return steamId ? steamId : `name:${String(player?.name || "").trim().toLowerCase()}`;
}

function sessionKey(row) {
  return row.steam_id ? row.steam_id : `name:${String(row.name || "").trim().toLowerCase()}`;
}

/**
 * Gleicht die aktuelle Spielerliste mit den offenen Sessions ab.
 * Neue Spieler starten eine Session, bekannte werden verlängert,
 * verschwundene werden nach einer Karenzzeit beendet.
 */
export const syncPlayerSessions = db.transaction((serverId, players, now = Date.now()) => {
  const list = Array.isArray(players) ? players.filter((player) => player?.name || player?.steamId) : [];
  const openRows = selectOpenSessionsStmt.all(String(serverId));
  const openByKey = new Map(openRows.map((row) => [sessionKey(row), row]));
  const seen = new Set();

  for (const player of list) {
    const key = identityKey(player);
    seen.add(key);

    insertPlayerSampleStmt.run(
      String(serverId),
      now,
      String(player.steamId || ""),
      String(player.name || ""),
      Number(player.score || 0),
      Number(player.durationSeconds || 0)
    );

    const existing = openByKey.get(key);
    if (existing) {
      const seconds = Math.max(0, Math.round((now - Number(existing.started_at)) / 1000));
      touchSessionStmt.run(now, seconds, String(player.name || existing.name || ""), existing.id);
      continue;
    }

    // Wenn der Server eine bereits gespielte Dauer meldet, wird der Startzeitpunkt
    // rückdatiert – so geht Spielzeit bei einem Bot-Neustart nicht verloren.
    const reportedSeconds = Math.max(0, Number(player.durationSeconds || 0));
    const startedAt = reportedSeconds > 0 ? now - reportedSeconds * 1000 : now;

    insertSessionStmt.run(
      createId("ses"),
      String(serverId),
      String(player.steamId || ""),
      String(player.name || ""),
      startedAt,
      now
    );
  }

  let closed = 0;
  for (const row of openRows) {
    if (seen.has(sessionKey(row))) {
      continue;
    }

    if (now - Number(row.last_seen_at) < SESSION_GRACE_MS) {
      continue;
    }

    const endedAt = Number(row.last_seen_at);
    const seconds = Math.max(0, Math.round((endedAt - Number(row.started_at)) / 1000));
    closeSessionStmt.run(endedAt, seconds, row.id);
    closed += 1;
  }

  return { tracked: list.length, closed };
});

// Beendet alle offenen Sessions, z. B. wenn der Server offline geht.
export const closeOpenSessions = db.transaction((serverId, now = Date.now()) => {
  const rows = selectOpenSessionsStmt.all(String(serverId));
  for (const row of rows) {
    const endedAt = Math.min(now, Number(row.last_seen_at));
    const seconds = Math.max(0, Math.round((endedAt - Number(row.started_at)) / 1000));
    closeSessionStmt.run(endedAt, seconds, row.id);
  }

  return rows.length;
});

export function getPlaytimeForSteamId(steamId, sinceMs = 0) {
  const since = sinceMs > 0 ? Date.now() - sinceMs : 0;
  const total = playtimeBySteamStmt.get(String(steamId), since);
  const perServer = playtimeBySteamAndServerStmt.all(String(steamId), since);

  return {
    seconds: Number(total?.seconds || 0),
    sessions: Number(total?.sessions || 0),
    lastSeen: Number(total?.last_seen || 0),
    perServer: perServer.map((row) => ({
      serverId: row.server_id,
      seconds: Number(row.seconds || 0),
      sessions: Number(row.sessions || 0),
      lastSeen: Number(row.last_seen || 0)
    }))
  };
}

export function getTopPlayers(serverId, { sinceMs = 30 * 24 * 60 * 60 * 1000, limit = 10 } = {}) {
  return topPlayersStmt.all(String(serverId), Date.now() - sinceMs, Math.min(100, limit)).map((row) => ({
    steamId: row.steam_id,
    name: row.name,
    seconds: Number(row.seconds || 0),
    sessions: Number(row.sessions || 0),
    lastSeen: Number(row.last_seen || 0)
  }));
}

export function getUniquePlayerCount(serverId, sinceMs = 7 * 24 * 60 * 60 * 1000) {
  return Number(uniquePlayersStmt.get(String(serverId), Date.now() - sinceMs)?.total || 0);
}

export function getRecentSessions(steamId, limit = 20) {
  return recentSessionsStmt.all(String(steamId), Math.min(200, limit)).map((row) => ({
    id: row.id,
    serverId: row.server_id,
    steamId: row.steam_id,
    name: row.name,
    startedAt: Number(row.started_at),
    lastSeenAt: Number(row.last_seen_at),
    endedAt: row.ended_at ? Number(row.ended_at) : null,
    seconds: Number(row.seconds || 0)
  }));
}
