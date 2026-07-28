import { createToken } from "../../core/ids.js";
import { recordAudit } from "../../core/audit.js";
import {
  SESSION_COOKIE,
  buildAuthorizeUrl,
  buildSteamLoginUrl,
  createSession,
  destroySession,
  exchangeCode,
  fetchDiscordUser,
  listAccessibleGuilds,
  verifySteamOpenId
} from "../auth.js";
import { appendCookie, redirect, sendJson, serializeCookie } from "../http.js";
import { setLink } from "../../modules/steamLink/services/store.js";
import { onSteamLinked } from "../../modules/steamLink/index.js";

const STATE_COOKIE = "trb_oauth_state";
const STEAM_STATE_COOKIE = "trb_steam_guild";

function cookieOptions(env, maxAge) {
  return {
    maxAge,
    secure: env.webBaseUrl.startsWith("https://"),
    sameSite: "Lax"
  };
}

export function registerAuthRoutes(router, { client, env }) {
  router.get("/api/auth/login", (ctx) => {
    const state = createToken(16);
    appendCookie(ctx.res, serializeCookie(STATE_COOKIE, state, cookieOptions(env, 600)));

    const redirectTo = ctx.url.searchParams.get("redirect") || "/";
    appendCookie(ctx.res, serializeCookie("trb_redirect", redirectTo, cookieOptions(env, 600)));

    redirect(ctx.res, buildAuthorizeUrl(env, state));
  });

  router.get("/api/auth/callback", async (ctx) => {
    const code = ctx.url.searchParams.get("code");
    const state = ctx.url.searchParams.get("state");

    if (!code || !state || state !== ctx.cookies[STATE_COOKIE]) {
      redirect(ctx.res, "/?error=state");
      return;
    }

    const token = await exchangeCode(env, code);
    const user = await fetchDiscordUser(token.access_token);
    const session = createSession(user);

    appendCookie(ctx.res, serializeCookie(SESSION_COOKIE, session.id, cookieOptions(env, 14 * 24 * 60 * 60)));
    appendCookie(ctx.res, serializeCookie(STATE_COOKIE, "", cookieOptions(env, 0)));

    const target = ctx.cookies.trb_redirect || "/";
    appendCookie(ctx.res, serializeCookie("trb_redirect", "", cookieOptions(env, 0)));

    redirect(ctx.res, target.startsWith("/") ? target : "/");
  });

  router.post("/api/auth/logout", (ctx) => {
    destroySession(ctx.session?.id);
    appendCookie(ctx.res, serializeCookie(SESSION_COOKIE, "", cookieOptions(env, 0)));
    sendJson(ctx.res, 200, { ok: true });
  });

  router.get("/api/auth/me", async (ctx) => {
    if (!ctx.session) {
      sendJson(ctx.res, 200, { authenticated: false });
      return;
    }

    const guilds = await listAccessibleGuilds(client, ctx.session.discordId);

    sendJson(ctx.res, 200, {
      authenticated: true,
      user: {
        id: ctx.session.discordId,
        username: ctx.session.username,
        displayName: ctx.session.displayName,
        avatarUrl: ctx.session.avatar
          ? `https://cdn.discordapp.com/avatars/${ctx.session.discordId}/${ctx.session.avatar}.png?size=128`
          : ""
      },
      guilds
    });
  });

  // Steam-Login über OpenID: kein API-Key nötig, Steam bestätigt die Identität selbst.
  router.get("/api/auth/steam", (ctx) => {
    if (!ctx.session) {
      redirect(ctx.res, "/api/auth/login");
      return;
    }

    const guildId = ctx.url.searchParams.get("guild") || "";
    appendCookie(ctx.res, serializeCookie(STEAM_STATE_COOKIE, guildId, cookieOptions(env, 600)));
    redirect(ctx.res, buildSteamLoginUrl(env, "/api/auth/steam/return"));
  });

  router.get("/api/auth/steam/return", async (ctx) => {
    if (!ctx.session) {
      redirect(ctx.res, "/");
      return;
    }

    const guildId = ctx.cookies[STEAM_STATE_COOKIE] || "";
    appendCookie(ctx.res, serializeCookie(STEAM_STATE_COOKIE, "", cookieOptions(env, 0)));

    const steamId = await verifySteamOpenId(ctx.url.searchParams);
    if (!steamId || !guildId) {
      redirect(ctx.res, `/#/steam?error=verify`);
      return;
    }

    try {
      const link = setLink({
        guildId,
        discordId: ctx.session.discordId,
        steamId,
        source: "openid"
      });

      recordAudit({
        guildId,
        actorId: ctx.session.discordId,
        actorName: ctx.session.username,
        action: "steam.link.openid",
        detail: { steamId }
      });

      await onSteamLinked(client, link).catch(() => null);
      redirect(ctx.res, `/#/g/${guildId}/steam?linked=1`);
    } catch (error) {
      redirect(ctx.res, `/#/g/${guildId}/steam?error=${encodeURIComponent(error.message)}`);
    }
  });
}
