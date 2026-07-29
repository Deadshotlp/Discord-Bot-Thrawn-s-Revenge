import { db } from "../../core/db.js";
import { createToken } from "../../core/ids.js";
import { recordAudit } from "../../core/audit.js";
import { ACCESS_LEVELS, requireLevel } from "../auth.js";
import { HttpError, sendJson } from "../http.js";
import { DAY_MS, getSeries } from "../../modules/monitoring/services/history.js";
import { getTopPlayers } from "../../modules/monitoring/services/playtime.js";
import { buildServerSummary } from "../../modules/monitoring/services/stats.js";
import { listServerKinds, queryServer } from "../../modules/monitoring/services/protocols/index.js";
import {
  createServer,
  deleteServer,
  getServer,
  listServers,
  updateServer
} from "../../modules/monitoring/services/servers.js";
import { pollServer, refreshPanel, syncPollJobs } from "../../modules/monitoring/services/poller.js";

const RANGES = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": DAY_MS,
  "7d": 7 * DAY_MS,
  "30d": 30 * DAY_MS,
  "90d": 90 * DAY_MS
};

const insertTokenStmt = db.prepare(`
  INSERT INTO ingest_tokens (token, guild_id, server_id, label, created_at)
  VALUES (?, ?, ?, ?, ?)
`);

const listTokensStmt = db.prepare(
  "SELECT token, label, created_at, last_used_at FROM ingest_tokens WHERE server_id = ?"
);

const deleteTokenStmt = db.prepare("DELETE FROM ingest_tokens WHERE token = ? AND guild_id = ?");

function requireOwnServer(guildId, serverId) {
  const server = getServer(serverId);
  if (!server || server.guildId !== guildId) {
    throw new HttpError(404, "Server nicht gefunden");
  }

  return server;
}

export function registerMonitoringRoutes(router, { client }) {
  router.get("/api/server-kinds", (ctx) => {
    sendJson(ctx.res, 200, listServerKinds());
  });

  router.get("/api/guilds/:guildId/servers", (ctx) => {
    const servers = listServers(ctx.params.guildId);
    sendJson(ctx.res, 200, servers.map((server) => buildServerSummary(server)));
  });

  router.post("/api/guilds/:guildId/servers", async (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.admin);

    let server;
    try {
      server = createServer(ctx.params.guildId, ctx.body, ctx.session.discordId);
    } catch (error) {
      throw new HttpError(400, error.message);
    }

    recordAudit({
      guildId: ctx.params.guildId,
      actorId: ctx.session.discordId,
      actorName: ctx.session.username,
      action: "monitor.server.create",
      detail: { serverId: server.id, name: server.name }
    });

    // Direkt eine erste Messung erzeugen, damit das Dashboard sofort Daten zeigt.
    await pollServer(client, server).catch(() => null);
    syncPollJobs(client);

    sendJson(ctx.res, 201, buildServerSummary(getServer(server.id)));
  });

  router.patch("/api/guilds/:guildId/servers/:serverId", (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.admin);
    requireOwnServer(ctx.params.guildId, ctx.params.serverId);

    let updated;
    try {
      updated = updateServer(ctx.params.serverId, ctx.body);
    } catch (error) {
      throw new HttpError(400, error.message);
    }

    recordAudit({
      guildId: ctx.params.guildId,
      actorId: ctx.session.discordId,
      actorName: ctx.session.username,
      action: "monitor.server.update",
      detail: { serverId: updated.id }
    });

    syncPollJobs(client);
    sendJson(ctx.res, 200, buildServerSummary(updated));
  });

  router.delete("/api/guilds/:guildId/servers/:serverId", (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.admin);
    const server = requireOwnServer(ctx.params.guildId, ctx.params.serverId);

    deleteServer(server.id);
    recordAudit({
      guildId: ctx.params.guildId,
      actorId: ctx.session.discordId,
      actorName: ctx.session.username,
      action: "monitor.server.delete",
      detail: { serverId: server.id, name: server.name }
    });

    syncPollJobs(client);
    sendJson(ctx.res, 200, { ok: true });
  });

  router.get("/api/guilds/:guildId/servers/:serverId/series", (ctx) => {
    const server = requireOwnServer(ctx.params.guildId, ctx.params.serverId);
    const rangeKey = ctx.url.searchParams.get("range") || "24h";
    const rangeMs = RANGES[rangeKey] || RANGES["24h"];
    const now = Date.now();

    sendJson(ctx.res, 200, {
      range: rangeKey,
      ...getSeries(server.id, {
        from: now - rangeMs,
        to: now,
        resolution: ctx.url.searchParams.get("resolution") || "auto"
      })
    });
  });

  router.get("/api/guilds/:guildId/servers/:serverId/players", (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.staff);
    const server = requireOwnServer(ctx.params.guildId, ctx.params.serverId);

    sendJson(ctx.res, 200, getTopPlayers(server.id, {
      sinceMs: RANGES[ctx.url.searchParams.get("range") || "30d"] || 30 * DAY_MS,
      limit: Number(ctx.url.searchParams.get("limit") || 25)
    }));
  });

  // Sofort-Abfrage ohne auf den nächsten Polling-Zyklus zu warten.
  router.post("/api/guilds/:guildId/servers/:serverId/probe", async (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.lead);
    const server = requireOwnServer(ctx.params.guildId, ctx.params.serverId);

    const result = await pollServer(client, server);
    sendJson(ctx.res, 200, {
      online: result.online,
      players: result.players,
      maxPlayers: result.maxPlayers,
      map: result.map,
      latencyMs: result.latencyMs,
      playerList: (result.playerList || []).slice(0, 100)
    });
  });

  router.post("/api/guilds/:guildId/servers/test", async (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.admin);

    const result = await queryServer({
      kind: ctx.body.kind || "source",
      host: ctx.body.host,
      port: ctx.body.port,
      queryPort: ctx.body.queryPort,
      meta: ctx.body.meta || {}
    });

    sendJson(ctx.res, 200, result);
  });

  router.post("/api/guilds/:guildId/panel/refresh", async (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.lead);
    await refreshPanel(client, ctx.params.guildId);
    sendJson(ctx.res, 200, { ok: true });
  });

  // Ingest-Token für das Spielserver-Addon (SteamIDs + Spielzeit).
  router.get("/api/guilds/:guildId/servers/:serverId/tokens", (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.admin);
    const server = requireOwnServer(ctx.params.guildId, ctx.params.serverId);

    sendJson(ctx.res, 200, listTokensStmt.all(server.id).map((row) => ({
      token: `${String(row.token).slice(0, 8)}…`,
      label: row.label,
      createdAt: Number(row.created_at),
      lastUsedAt: Number(row.last_used_at || 0)
    })));
  });

  router.post("/api/guilds/:guildId/servers/:serverId/tokens", (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.admin);
    const server = requireOwnServer(ctx.params.guildId, ctx.params.serverId);

    const token = createToken(24);
    insertTokenStmt.run(token, ctx.params.guildId, server.id, String(ctx.body.label || "").slice(0, 60), Date.now());

    recordAudit({
      guildId: ctx.params.guildId,
      actorId: ctx.session.discordId,
      actorName: ctx.session.username,
      action: "monitor.token.create",
      detail: { serverId: server.id }
    });

    // Der Klartext-Token wird genau einmal ausgeliefert.
    sendJson(ctx.res, 201, { token });
  });

  router.delete("/api/guilds/:guildId/servers/:serverId/tokens/:token", (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.admin);
    deleteTokenStmt.run(ctx.params.token, ctx.params.guildId);
    sendJson(ctx.res, 200, { ok: true });
  });
}
