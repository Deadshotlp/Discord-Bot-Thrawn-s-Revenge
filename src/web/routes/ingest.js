import { db } from "../../core/db.js";
import { HttpError, sendJson } from "../http.js";
import { syncPlayerSessions } from "../../modules/monitoring/services/playtime.js";
import { getServer } from "../../modules/monitoring/services/servers.js";
import { parseSteamId } from "../../modules/steamLink/services/steamId.js";
import { redeemLinkCode } from "../../modules/steamLink/services/store.js";
import { onSteamLinked } from "../../modules/steamLink/index.js";

const selectTokenStmt = db.prepare("SELECT * FROM ingest_tokens WHERE token = ?");
const touchTokenStmt = db.prepare("UPDATE ingest_tokens SET last_used_at = ? WHERE token = ?");

/**
 * Authentifizierung für das Spielserver-Addon.
 * Der Token gehört zu genau einem überwachten Server und wird im Dashboard erzeugt.
 */
function requireIngestToken(ctx) {
  const token = String(
    ctx.req.headers["x-ingest-token"] || ctx.body?.token || ctx.url.searchParams.get("token") || ""
  ).trim();

  if (!token) {
    throw new HttpError(401, "Ingest-Token fehlt");
  }

  const row = selectTokenStmt.get(token);
  if (!row) {
    throw new HttpError(401, "Ingest-Token ungültig");
  }

  const server = getServer(row.server_id);
  if (!server) {
    throw new HttpError(404, "Zugehöriger Server existiert nicht mehr");
  }

  touchTokenStmt.run(Date.now(), token);
  return { guildId: row.guild_id, server };
}

export function registerIngestRoutes(router, { client }) {
  router.get("/api/ingest/ping", (ctx) => {
    const { server } = requireIngestToken(ctx);
    sendJson(ctx.res, 200, { ok: true, server: server.name, time: Date.now() });
  });

  // Spielerliste mit echten SteamIDs – Grundlage für die Spielzeiterfassung.
  router.post("/api/ingest/players", (ctx) => {
    const { server } = requireIngestToken(ctx);
    const raw = Array.isArray(ctx.body?.players) ? ctx.body.players : [];

    const players = raw
      .map((entry) => ({
        steamId: parseSteamId(entry?.steamId || entry?.steamid || entry?.steamID64) || "",
        name: String(entry?.name || "").slice(0, 100),
        durationSeconds: Math.max(0, Number(entry?.durationSeconds || entry?.time || 0)),
        score: Number(entry?.score || 0)
      }))
      .filter((entry) => entry.steamId || entry.name);

    const result = syncPlayerSessions(server.id, players);
    sendJson(ctx.res, 200, { ok: true, ...result });
  });

  // Einlösen des Verknüpfungscodes, den der Spieler im Spiel eingibt.
  router.post("/api/ingest/link", async (ctx) => {
    requireIngestToken(ctx);

    const code = String(ctx.body?.code || "").trim().toUpperCase();
    const steamId = parseSteamId(ctx.body?.steamId || ctx.body?.steamid);

    if (!code || !steamId) {
      throw new HttpError(400, "Code oder SteamID fehlt");
    }

    const result = redeemLinkCode(code, steamId);
    if (!result.ok) {
      const messages = {
        unknown_code: "Code unbekannt.",
        expired: "Code ist abgelaufen.",
        conflict: result.message || "SteamID bereits vergeben."
      };

      sendJson(ctx.res, 200, { ok: false, reason: result.reason, message: messages[result.reason] });
      return;
    }

    await onSteamLinked(client, result.link).catch(() => null);
    sendJson(ctx.res, 200, { ok: true, message: "Discord erfolgreich verknüpft." });
  });
}
