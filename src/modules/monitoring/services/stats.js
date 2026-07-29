import {
  DAY_MS,
  HOUR_MS,
  getHourOfDayProfile,
  getLatestSample,
  getSeries,
  getTopMaps,
  getUptime,
  getWeekdayProfile
} from "./history.js";
import { getTopPlayers, getUniquePlayerCount } from "./playtime.js";
import { buildConnectLink } from "./protocols/index.js";

function peakOf(points, key = "peak") {
  let peak = 0;
  let peakAt = 0;

  for (const point of points) {
    const value = Number(point[key] ?? point.players ?? 0);
    if (value > peak) {
      peak = value;
      peakAt = point.at;
    }
  }

  return { peak, peakAt };
}

function averageOf(points, key = "players") {
  const values = points
    .filter((point) => point.online !== false)
    .map((point) => Number(point[key] ?? 0));

  if (values.length === 0) {
    return 0;
  }

  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

/**
 * Kennzahlen-Paket für Panel und Dashboard.
 * Alles, was mehr aussagt als "X/Y Spieler": Trend, Auslastung, Uptime,
 * Peak-Zeiten, Map-Verteilung und wiederkehrende Spieler.
 */
export function buildServerSummary(server, { now = Date.now() } = {}) {
  const latest = getLatestSample(server.id);
  const last24h = getSeries(server.id, { from: now - DAY_MS, to: now, resolution: "raw" }).points;
  const last7d = getSeries(server.id, { from: now - 7 * DAY_MS, to: now, resolution: "hour" }).points;
  const last30d = getSeries(server.id, { from: now - 30 * DAY_MS, to: now, resolution: "day" }).points;

  const peak24h = peakOf(last24h, "players");
  const peak7d = peakOf(last7d, "peak");
  const peak30d = peakOf(last30d, "peak");

  const hourProfile = getHourOfDayProfile(server.id);
  const bestHour = hourProfile.reduce(
    (best, entry) => (entry.average > best.average ? entry : best),
    { hour: -1, average: 0, peak: 0 }
  );

  const previousDay = last7d.filter((point) => point.at >= now - 2 * DAY_MS && point.at < now - DAY_MS);
  const currentDayAverage = averageOf(last24h, "players");
  const previousDayAverage = averageOf(previousDay, "players");
  const trendPercent = previousDayAverage > 0
    ? Math.round(((currentDayAverage - previousDayAverage) / previousDayAverage) * 1000) / 10
    : null;

  const maxPlayers = Number(latest?.maxPlayers || 0);
  const fillPercent = maxPlayers > 0
    ? Math.round((Number(latest?.players || 0) / maxPlayers) * 1000) / 10
    : null;

  return {
    server: {
      id: server.id,
      name: server.name,
      kind: server.kind,
      host: server.host,
      port: server.port,
      color: server.color,
      enabled: server.enabled,
      intervalSeconds: server.intervalSeconds,
      connectLink: buildConnectLink(server)
    },
    current: latest
      ? {
        online: latest.online,
        players: latest.players,
        maxPlayers: latest.maxPlayers,
        bots: latest.bots,
        map: latest.map,
        latencyMs: latest.latencyMs,
        version: latest.version,
        takenAt: latest.takenAt,
        stale: now - latest.takenAt > Math.max(2 * server.intervalSeconds * 1000, 5 * 60 * 1000)
      }
      : null,
    fillPercent,
    trendPercent,
    averages: {
      last24h: currentDayAverage,
      last7d: averageOf(last7d, "players"),
      last30d: averageOf(last30d, "players")
    },
    peaks: {
      last24h: peak24h,
      last7d: peak7d,
      last30d: peak30d
    },
    uptime: {
      last24h: getUptime(server.id, DAY_MS),
      last7d: getUptime(server.id, 7 * DAY_MS),
      last30d: getUptime(server.id, 30 * DAY_MS)
    },
    bestHour: bestHour.hour >= 0 ? bestHour : null,
    hourProfile,
    weekdayProfile: getWeekdayProfile(server.id),
    topMaps: getTopMaps(server.id),
    uniquePlayers: {
      last7d: getUniquePlayerCount(server.id, 7 * DAY_MS),
      last30d: getUniquePlayerCount(server.id, 30 * DAY_MS)
    },
    topPlayers: getTopPlayers(server.id, { sinceMs: 30 * DAY_MS, limit: 10 })
  };
}

// Reduziert eine feine Zeitreihe auf eine handliche Punktzahl für Diagramme.
export function downsample(points, targetPoints = 120) {
  if (!Array.isArray(points) || points.length <= targetPoints) {
    return points || [];
  }

  const bucketSize = Math.ceil(points.length / targetPoints);
  const result = [];

  for (let index = 0; index < points.length; index += bucketSize) {
    const bucket = points.slice(index, index + bucketSize);
    const online = bucket.filter((point) => point.online !== false);
    const players = online.map((point) => Number(point.players || 0));

    result.push({
      at: bucket[Math.floor(bucket.length / 2)].at,
      players: players.length > 0
        ? Math.round((players.reduce((sum, value) => sum + value, 0) / players.length) * 10) / 10
        : 0,
      peak: players.length > 0 ? Math.max(...players) : 0,
      online: online.length > 0,
      maxPlayers: Math.max(...bucket.map((point) => Number(point.maxPlayers || 0)))
    });
  }

  return result;
}

export { DAY_MS, HOUR_MS };
