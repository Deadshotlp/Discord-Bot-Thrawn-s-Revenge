import { PermissionFlagsBits } from "discord.js";
import { db } from "../core/db.js";
import { createToken } from "../core/ids.js";
import { HttpError } from "./http.js";
import { normalizeDepartments } from "../modules/support/services/config.js";

export const SESSION_COOKIE = "trb_session";
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const DISCORD_API = "https://discord.com/api/v10";

const insertSessionStmt = db.prepare(`
  INSERT INTO web_sessions (id, discord_id, username, display_name, avatar, created_at, expires_at, data_json)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const selectSessionStmt = db.prepare("SELECT * FROM web_sessions WHERE id = ?");
const deleteSessionStmt = db.prepare("DELETE FROM web_sessions WHERE id = ?");
const pruneSessionsStmt = db.prepare("DELETE FROM web_sessions WHERE expires_at < ?");

export function createSession(user) {
  pruneSessionsStmt.run(Date.now());

  const id = createToken(32);
  const now = Date.now();

  insertSessionStmt.run(
    id,
    String(user.id),
    String(user.username || ""),
    String(user.global_name || user.username || ""),
    String(user.avatar || ""),
    now,
    now + SESSION_TTL_MS,
    JSON.stringify({})
  );

  return { id, expiresAt: now + SESSION_TTL_MS };
}

export function getSession(sessionId) {
  if (!sessionId) {
    return null;
  }

  const row = selectSessionStmt.get(String(sessionId));
  if (!row) {
    return null;
  }

  if (Number(row.expires_at) < Date.now()) {
    deleteSessionStmt.run(row.id);
    return null;
  }

  return {
    id: row.id,
    discordId: row.discord_id,
    username: row.username,
    displayName: row.display_name || row.username,
    avatar: row.avatar,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at)
  };
}

export function destroySession(sessionId) {
  if (sessionId) {
    deleteSessionStmt.run(String(sessionId));
  }
}

export function buildAuthorizeUrl(env, state) {
  const params = new URLSearchParams({
    client_id: env.discordClientId,
    redirect_uri: `${env.webBaseUrl}/api/auth/callback`,
    response_type: "code",
    scope: "identify",
    state,
    prompt: "none"
  });

  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

export async function exchangeCode(env, code) {
  const response = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.discordClientId,
      client_secret: env.discordClientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: `${env.webBaseUrl}/api/auth/callback`
    })
  });

  if (!response.ok) {
    throw new HttpError(401, "Discord-Anmeldung fehlgeschlagen");
  }

  return response.json();
}

export async function fetchDiscordUser(accessToken) {
  const response = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    throw new HttpError(401, "Discord-Profil konnte nicht geladen werden");
  }

  return response.json();
}

export const ACCESS_LEVELS = Object.freeze({
  none: 0,
  member: 1,
  staff: 2,
  lead: 3,
  admin: 4
});

/**
 * Ermittelt die Zugriffsstufe eines Nutzers auf einem Server.
 * Grundlage sind die echten Discord-Rollen – der Bot liest sie aus seinem
 * eigenen Guild-Cache, es werden keine zusätzlichen OAuth-Scopes benötigt.
 */
export async function resolveGuildAccess(client, guildId, discordId) {
  const guild = client.guilds.cache.get(String(guildId));
  if (!guild) {
    return { level: ACCESS_LEVELS.none, departments: [], leadDepartments: [], guild: null, member: null };
  }

  const member = await guild.members.fetch(String(discordId)).catch(() => null);
  if (!member) {
    return { level: ACCESS_LEVELS.none, departments: [], leadDepartments: [], guild, member: null };
  }

  if (guild.ownerId === member.id
    || member.permissions.has(PermissionFlagsBits.Administrator)
    || member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return { level: ACCESS_LEVELS.admin, departments: [], leadDepartments: [], guild, member };
  }

  const supportConfig = client.botContext.settingsStore.getModuleState(guild.id, "support")?.config;
  const departments = normalizeDepartments(supportConfig?.departments);

  const memberDepartments = departments.filter((department) =>
    department.roleIds.some((roleId) => member.roles.cache.has(roleId)));

  const leadDepartments = departments.filter((department) =>
    (department.leadRoleIds || []).some((roleId) => member.roles.cache.has(roleId)));

  if (leadDepartments.length > 0) {
    return {
      level: ACCESS_LEVELS.lead,
      departments: memberDepartments.map((department) => department.id),
      leadDepartments: leadDepartments.map((department) => department.id),
      guild,
      member
    };
  }

  if (memberDepartments.length > 0) {
    return {
      level: ACCESS_LEVELS.staff,
      departments: memberDepartments.map((department) => department.id),
      leadDepartments: [],
      guild,
      member
    };
  }

  return { level: ACCESS_LEVELS.member, departments: [], leadDepartments: [], guild, member };
}

export async function listAccessibleGuilds(client, discordId) {
  const result = [];

  for (const guild of client.guilds.cache.values()) {
    const access = await resolveGuildAccess(client, guild.id, discordId);
    if (access.level < ACCESS_LEVELS.member) {
      continue;
    }

    result.push({
      id: guild.id,
      name: guild.name,
      icon: guild.iconURL({ size: 128 }) || "",
      memberCount: guild.memberCount,
      accessLevel: access.level,
      departments: access.departments,
      leadDepartments: access.leadDepartments
    });
  }

  return result.sort((a, b) => b.accessLevel - a.accessLevel || a.name.localeCompare(b.name));
}

export function requireLevel(access, level) {
  if (!access || access.level < level) {
    throw new HttpError(403, "Keine Berechtigung für diese Aktion");
  }
}

// --- Steam OpenID 2.0 -------------------------------------------------------

const STEAM_OPENID = "https://steamcommunity.com/openid/login";

export function buildSteamLoginUrl(env, returnPath) {
  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": `${env.webBaseUrl}${returnPath}`,
    "openid.realm": env.webBaseUrl,
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select"
  });

  return `${STEAM_OPENID}?${params.toString()}`;
}

/**
 * Prüft die Steam-Antwort, indem sie unverändert an Steam zurückgeschickt wird
 * (check_authentication). Nur wenn Steam "is_valid:true" antwortet, gilt die ID.
 */
export async function verifySteamOpenId(query) {
  const params = new URLSearchParams();

  for (const [key, value] of query.entries()) {
    if (key.startsWith("openid.")) {
      params.append(key, value);
    }
  }

  params.set("openid.mode", "check_authentication");

  const response = await fetch(STEAM_OPENID, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params
  });

  const text = await response.text();
  if (!/is_valid\s*:\s*true/i.test(text)) {
    return null;
  }

  const claimedId = query.get("openid.claimed_id") || "";
  const match = claimedId.match(/\/id\/(\d{17})$/) || claimedId.match(/(\d{17})$/);
  return match ? match[1] : null;
}
