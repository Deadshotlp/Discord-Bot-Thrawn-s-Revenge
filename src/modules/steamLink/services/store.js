import { db } from "../../../core/db.js";
import { createHumanCode } from "../../../core/ids.js";
import { parseSteamId } from "./steamId.js";

const CODE_TTL_MS = 30 * 60 * 1000;

const selectLinkByDiscordStmt = db.prepare(
  "SELECT * FROM steam_links WHERE guild_id = ? AND discord_id = ?"
);

const selectLinkBySteamStmt = db.prepare(
  "SELECT * FROM steam_links WHERE guild_id = ? AND steam_id = ?"
);

const selectLinksByGuildStmt = db.prepare(
  "SELECT * FROM steam_links WHERE guild_id = ? ORDER BY verified_at DESC"
);

const selectAllLinksForSteamStmt = db.prepare(
  "SELECT * FROM steam_links WHERE steam_id = ?"
);

const upsertLinkStmt = db.prepare(`
  INSERT INTO steam_links (guild_id, discord_id, steam_id, source, verified_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (guild_id, discord_id) DO UPDATE SET
    steam_id = excluded.steam_id,
    source = excluded.source,
    verified_at = excluded.verified_at
`);

const deleteLinkStmt = db.prepare(
  "DELETE FROM steam_links WHERE guild_id = ? AND discord_id = ?"
);

const insertCodeStmt = db.prepare(`
  INSERT INTO steam_link_codes (code, guild_id, discord_id, created_at, expires_at)
  VALUES (?, ?, ?, ?, ?)
`);

const selectCodeStmt = db.prepare("SELECT * FROM steam_link_codes WHERE code = ?");
const deleteCodeStmt = db.prepare("DELETE FROM steam_link_codes WHERE code = ?");
const deleteUserCodesStmt = db.prepare(
  "DELETE FROM steam_link_codes WHERE guild_id = ? AND discord_id = ?"
);
const pruneCodesStmt = db.prepare("DELETE FROM steam_link_codes WHERE expires_at < ?");

function toLink(row) {
  if (!row) {
    return null;
  }

  return {
    guildId: row.guild_id,
    discordId: row.discord_id,
    steamId: row.steam_id,
    source: row.source,
    verifiedAt: Number(row.verified_at || 0)
  };
}

export function getLinkByDiscordId(guildId, discordId) {
  return toLink(selectLinkByDiscordStmt.get(String(guildId), String(discordId)));
}

export function getLinkBySteamId(guildId, steamId) {
  return toLink(selectLinkBySteamStmt.get(String(guildId), String(steamId)));
}

export function listLinks(guildId) {
  return selectLinksByGuildStmt.all(String(guildId)).map(toLink);
}

export function listGuildsForSteamId(steamId) {
  return selectAllLinksForSteamStmt.all(String(steamId)).map(toLink);
}

export function setLink({ guildId, discordId, steamId, source = "code" }) {
  const normalized = parseSteamId(steamId);
  if (!normalized) {
    throw new Error("Ungültige SteamID. Erlaubt sind SteamID64, STEAM_0:X:Y, [U:1:Z] oder ein Profil-Link.");
  }

  const conflict = getLinkBySteamId(guildId, normalized);
  if (conflict && conflict.discordId !== String(discordId)) {
    throw new Error("Diese SteamID ist bereits mit einem anderen Discord-Account verknüpft.");
  }

  upsertLinkStmt.run(String(guildId), String(discordId), normalized, String(source), Date.now());
  return getLinkByDiscordId(guildId, discordId);
}

export function removeLink(guildId, discordId) {
  return deleteLinkStmt.run(String(guildId), String(discordId)).changes > 0;
}

/**
 * Erzeugt einen Bestätigungscode, den der Spieler im Spiel eingibt.
 * Das Ingest-Addon meldet Code + SteamID zurück und schließt damit die Verknüpfung.
 */
export function createLinkCode(guildId, discordId) {
  pruneCodesStmt.run(Date.now());
  deleteUserCodesStmt.run(String(guildId), String(discordId));

  const code = createHumanCode(6);
  const now = Date.now();
  insertCodeStmt.run(code, String(guildId), String(discordId), now, now + CODE_TTL_MS);

  return { code, expiresAt: now + CODE_TTL_MS };
}

export function redeemLinkCode(code, steamId) {
  pruneCodesStmt.run(Date.now());

  const row = selectCodeStmt.get(String(code || "").trim().toUpperCase());
  if (!row) {
    return { ok: false, reason: "unknown_code" };
  }

  if (Number(row.expires_at) < Date.now()) {
    deleteCodeStmt.run(row.code);
    return { ok: false, reason: "expired" };
  }

  try {
    const link = setLink({
      guildId: row.guild_id,
      discordId: row.discord_id,
      steamId,
      source: "ingame"
    });

    deleteCodeStmt.run(row.code);
    return { ok: true, link };
  } catch (error) {
    return { ok: false, reason: "conflict", message: error.message };
  }
}

export { CODE_TTL_MS };
