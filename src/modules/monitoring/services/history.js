import { db } from "../../../core/db.js";

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

// Rohdaten bleiben 14 Tage (feine Auflösung), Stunden-Rollups 180 Tage,
// Tages-Rollups bleiben dauerhaft erhalten.
export const RAW_RETENTION_MS = 14 * DAY_MS;
export const HOUR_ROLLUP_RETENTION_MS = 180 * DAY_MS;

const insertSampleStmt = db.prepare(`
  INSERT INTO monitor_samples (server_id, taken_at, online, players, max_players, bots, map, latency_ms, version)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const upsertRollupStmt = db.prepare(`
  INSERT INTO monitor_rollups (
    server_id, bucket, bucket_start, samples, online_samples,
    players_sum, players_peak, players_min, max_players, latency_sum, top_map
  ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (server_id, bucket, bucket_start) DO UPDATE SET
    samples = samples + 1,
    online_samples = online_samples + excluded.online_samples,
    players_sum = players_sum + excluded.players_sum,
    players_peak = MAX(players_peak, excluded.players_peak),
    players_min = MIN(players_min, excluded.players_min),
    max_players = MAX(max_players, excluded.max_players),
    latency_sum = latency_sum + excluded.latency_sum,
    top_map = CASE WHEN excluded.top_map != '' THEN excluded.top_map ELSE top_map END
`);

const selectRawStmt = db.prepare(`
  SELECT taken_at, online, players, max_players, bots, map, latency_ms
  FROM monitor_samples
  WHERE server_id = ? AND taken_at >= ? AND taken_at <= ?
  ORDER BY taken_at ASC
`);

const selectRollupStmt = db.prepare(`
  SELECT bucket_start, samples, online_samples, players_sum, players_peak, players_min, max_players, latency_sum, top_map
  FROM monitor_rollups
  WHERE server_id = ? AND bucket = ? AND bucket_start >= ? AND bucket_start <= ?
  ORDER BY bucket_start ASC
`);

const selectLatestStmt = db.prepare(`
  SELECT taken_at, online, players, max_players, bots, map, latency_ms, version
  FROM monitor_samples
  WHERE server_id = ?
  ORDER BY taken_at DESC
  LIMIT 1
`);

const uptimeStmt = db.prepare(`
  SELECT COUNT(*) AS samples, SUM(online) AS online_samples
  FROM monitor_samples
  WHERE server_id = ? AND taken_at >= ?
`);

const uptimeRollupStmt = db.prepare(`
  SELECT SUM(samples) AS samples, SUM(online_samples) AS online_samples
  FROM monitor_rollups
  WHERE server_id = ? AND bucket = 'hour' AND bucket_start >= ?
`);

const topMapsStmt = db.prepare(`
  SELECT map, COUNT(*) AS samples, MAX(players) AS peak, AVG(players) AS average
  FROM monitor_samples
  WHERE server_id = ? AND taken_at >= ? AND online = 1 AND map != ''
  GROUP BY map
  ORDER BY samples DESC
  LIMIT 8
`);

const hourOfDayStmt = db.prepare(`
  SELECT CAST(strftime('%H', taken_at / 1000, 'unixepoch', 'localtime') AS INTEGER) AS hour,
         AVG(players) AS average,
         MAX(players) AS peak
  FROM monitor_samples
  WHERE server_id = ? AND taken_at >= ? AND online = 1
  GROUP BY hour
  ORDER BY hour ASC
`);

const weekdayStmt = db.prepare(`
  SELECT CAST(strftime('%w', taken_at / 1000, 'unixepoch', 'localtime') AS INTEGER) AS weekday,
         AVG(players) AS average,
         MAX(players) AS peak
  FROM monitor_samples
  WHERE server_id = ? AND taken_at >= ? AND online = 1
  GROUP BY weekday
  ORDER BY weekday ASC
`);

function bucketStart(timestamp, bucket) {
  const date = new Date(timestamp);
  if (bucket === "day") {
    date.setHours(0, 0, 0, 0);
  } else {
    date.setMinutes(0, 0, 0);
  }

  return date.getTime();
}

const recordTransaction = db.transaction((serverId, takenAt, sample) => {
  insertSampleStmt.run(
    serverId,
    takenAt,
    sample.online ? 1 : 0,
    sample.players,
    sample.maxPlayers,
    sample.bots,
    sample.map,
    sample.latencyMs,
    sample.version
  );

  for (const bucket of ["hour", "day"]) {
    upsertRollupStmt.run(
      serverId,
      bucket,
      bucketStart(takenAt, bucket),
      sample.online ? 1 : 0,
      sample.players,
      sample.players,
      sample.online ? sample.players : 0,
      sample.maxPlayers,
      sample.latencyMs,
      sample.online ? sample.map : ""
    );
  }
});

export function recordSample(serverId, result, takenAt = Date.now()) {
  const sample = {
    online: Boolean(result?.online),
    players: Math.max(0, Number(result?.players || 0)),
    maxPlayers: Math.max(0, Number(result?.maxPlayers || 0)),
    bots: Math.max(0, Number(result?.bots || 0)),
    map: String(result?.map || ""),
    latencyMs: Math.max(0, Math.round(Number(result?.latencyMs || 0))),
    version: String(result?.version || "")
  };

  recordTransaction(String(serverId), takenAt, sample);
  return { takenAt, ...sample };
}

export function getLatestSample(serverId) {
  const row = selectLatestStmt.get(String(serverId));
  if (!row) {
    return null;
  }

  return {
    takenAt: Number(row.taken_at),
    online: Boolean(row.online),
    players: Number(row.players),
    maxPlayers: Number(row.max_players),
    bots: Number(row.bots),
    map: row.map || "",
    latencyMs: Number(row.latency_ms || 0),
    version: row.version || ""
  };
}

/**
 * Zeitreihe für Diagramme. Wählt automatisch die passende Auflösung:
 * bis 2 Tage Rohdaten, bis 30 Tage Stundenwerte, darüber Tageswerte.
 */
export function getSeries(serverId, { from, to = Date.now(), resolution = "auto" } = {}) {
  const start = Number(from);
  const end = Number(to);
  const span = end - start;

  let effective = resolution;
  if (resolution === "auto") {
    if (span <= 2 * DAY_MS) {
      effective = "raw";
    } else if (span <= 31 * DAY_MS) {
      effective = "hour";
    } else {
      effective = "day";
    }
  }

  if (effective === "raw") {
    const points = selectRawStmt.all(String(serverId), start, end).map((row) => ({
      at: Number(row.taken_at),
      players: Number(row.players),
      peak: Number(row.players),
      maxPlayers: Number(row.max_players),
      online: Boolean(row.online),
      map: row.map || "",
      latencyMs: Number(row.latency_ms || 0)
    }));

    return { resolution: "raw", points };
  }

  const points = selectRollupStmt.all(String(serverId), effective, start, end).map((row) => {
    const samples = Number(row.samples || 0) || 1;
    const onlineSamples = Number(row.online_samples || 0);

    return {
      at: Number(row.bucket_start),
      players: Math.round((Number(row.players_sum || 0) / samples) * 10) / 10,
      peak: Number(row.players_peak || 0),
      min: Number(row.players_min || 0),
      maxPlayers: Number(row.max_players || 0),
      uptime: Math.round((onlineSamples / samples) * 1000) / 10,
      latencyMs: Math.round(Number(row.latency_sum || 0) / samples),
      map: row.top_map || "",
      online: onlineSamples > 0
    };
  });

  return { resolution: effective, points };
}

export function getUptime(serverId, sinceMs) {
  const since = Date.now() - sinceMs;
  const source = sinceMs <= RAW_RETENTION_MS ? uptimeStmt : uptimeRollupStmt;
  const row = source.get(String(serverId), since);
  const samples = Number(row?.samples || 0);

  if (samples === 0) {
    return null;
  }

  return Math.round((Number(row?.online_samples || 0) / samples) * 1000) / 10;
}

export function getTopMaps(serverId, sinceMs = 7 * DAY_MS) {
  return topMapsStmt.all(String(serverId), Date.now() - sinceMs).map((row) => ({
    map: row.map,
    samples: Number(row.samples),
    peak: Number(row.peak),
    average: Math.round(Number(row.average || 0) * 10) / 10
  }));
}

export function getHourOfDayProfile(serverId, sinceMs = 14 * DAY_MS) {
  const rows = hourOfDayStmt.all(String(serverId), Date.now() - sinceMs);
  const profile = Array.from({ length: 24 }, (_, hour) => ({ hour, average: 0, peak: 0 }));

  for (const row of rows) {
    const hour = Number(row.hour);
    if (hour >= 0 && hour < 24) {
      profile[hour] = {
        hour,
        average: Math.round(Number(row.average || 0) * 10) / 10,
        peak: Number(row.peak || 0)
      };
    }
  }

  return profile;
}

export function getWeekdayProfile(serverId, sinceMs = 28 * DAY_MS) {
  const labels = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  const rows = weekdayStmt.all(String(serverId), Date.now() - sinceMs);
  const profile = labels.map((label, weekday) => ({ weekday, label, average: 0, peak: 0 }));

  for (const row of rows) {
    const weekday = Number(row.weekday);
    if (weekday >= 0 && weekday < 7) {
      profile[weekday] = {
        weekday,
        label: labels[weekday],
        average: Math.round(Number(row.average || 0) * 10) / 10,
        peak: Number(row.peak || 0)
      };
    }
  }

  return profile;
}

export function pruneHistory(now = Date.now()) {
  const removedRaw = db
    .prepare("DELETE FROM monitor_samples WHERE taken_at < ?")
    .run(now - RAW_RETENTION_MS).changes;

  const removedHours = db
    .prepare("DELETE FROM monitor_rollups WHERE bucket = 'hour' AND bucket_start < ?")
    .run(now - HOUR_ROLLUP_RETENTION_MS).changes;

  const removedPlayerSamples = db
    .prepare("DELETE FROM monitor_player_samples WHERE taken_at < ?")
    .run(now - RAW_RETENTION_MS).changes;

  return { removedRaw, removedHours, removedPlayerSamples };
}
