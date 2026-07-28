import { ACCESS_LEVELS, requireLevel } from "../auth.js";
import { HttpError, sendJson } from "../http.js";
import { recordAudit } from "../../core/audit.js";
import { describeSteamId } from "../../modules/steamLink/services/steamId.js";
import { getLinkByDiscordId, listLinks, removeLink, setLink } from "../../modules/steamLink/services/store.js";
import { syncLinkedRole } from "../../modules/steamLink/services/roles.js";
import { getPlaytimeForSteamId, getRecentSessions } from "../../modules/monitoring/services/playtime.js";
import { listServers } from "../../modules/monitoring/services/servers.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function registerSteamRoutes(router, { client }) {
  router.get("/api/guilds/:guildId/steam/me", (ctx) => {
    const link = getLinkByDiscordId(ctx.params.guildId, ctx.session.discordId);
    if (!link) {
      sendJson(ctx.res, 200, { linked: false });
      return;
    }

    const stats = getPlaytimeForSteamId(link.steamId, 30 * DAY_MS);
    const servers = new Map(listServers(ctx.params.guildId).map((server) => [server.id, server.name]));

    sendJson(ctx.res, 200, {
      linked: true,
      link: { ...link, ...describeSteamId(link.steamId) },
      playtime: {
        ...stats,
        perServer: stats.perServer
          .filter((entry) => servers.has(entry.serverId))
          .map((entry) => ({ ...entry, serverName: servers.get(entry.serverId) }))
      },
      sessions: getRecentSessions(link.steamId, 20)
        .filter((session) => servers.has(session.serverId))
        .map((session) => ({ ...session, serverName: servers.get(session.serverId) }))
    });
  });

  router.delete("/api/guilds/:guildId/steam/me", async (ctx) => {
    removeLink(ctx.params.guildId, ctx.session.discordId);
    await syncLinkedRole(client, ctx.params.guildId, ctx.session.discordId, false).catch(() => null);
    sendJson(ctx.res, 200, { ok: true });
  });

  router.get("/api/guilds/:guildId/steam/links", async (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.lead);

    const links = listLinks(ctx.params.guildId);
    const servers = new Map(listServers(ctx.params.guildId).map((server) => [server.id, server.name]));
    const guild = ctx.access.guild;

    const rows = [];
    for (const link of links) {
      const member = guild.members.cache.get(link.discordId)
        || await guild.members.fetch(link.discordId).catch(() => null);
      const stats = getPlaytimeForSteamId(link.steamId, 30 * DAY_MS);

      rows.push({
        ...link,
        ...describeSteamId(link.steamId),
        userName: member?.displayName || link.discordId,
        avatarUrl: member?.displayAvatarURL({ size: 64 }) || "",
        playtimeSeconds: stats.seconds,
        sessions: stats.sessions,
        lastSeen: stats.lastSeen,
        servers: stats.perServer
          .filter((entry) => servers.has(entry.serverId))
          .map((entry) => ({ name: servers.get(entry.serverId), seconds: entry.seconds }))
      });
    }

    sendJson(ctx.res, 200, rows.sort((a, b) => b.playtimeSeconds - a.playtimeSeconds));
  });

  router.post("/api/guilds/:guildId/steam/links", async (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.admin);

    try {
      const link = setLink({
        guildId: ctx.params.guildId,
        discordId: String(ctx.body.discordId || ""),
        steamId: ctx.body.steamId,
        source: "manual"
      });

      recordAudit({
        guildId: ctx.params.guildId,
        actorId: ctx.session.discordId,
        actorName: ctx.session.username,
        action: "steam.link.manual",
        detail: { userId: link.discordId, steamId: link.steamId }
      });

      await syncLinkedRole(client, ctx.params.guildId, link.discordId, true).catch(() => null);
      sendJson(ctx.res, 201, link);
    } catch (error) {
      throw new HttpError(400, error.message);
    }
  });

  router.delete("/api/guilds/:guildId/steam/links/:discordId", async (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.admin);

    removeLink(ctx.params.guildId, ctx.params.discordId);
    await syncLinkedRole(client, ctx.params.guildId, ctx.params.discordId, false).catch(() => null);

    recordAudit({
      guildId: ctx.params.guildId,
      actorId: ctx.session.discordId,
      actorName: ctx.session.username,
      action: "steam.unlink",
      detail: { userId: ctx.params.discordId }
    });

    sendJson(ctx.res, 200, { ok: true });
  });
}
