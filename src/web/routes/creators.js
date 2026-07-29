import { ACCESS_LEVELS, requireLevel } from "../auth.js";
import { sendJson } from "../http.js";
import { recordAudit } from "../../core/audit.js";
import { applyCreatorConfig } from "../../modules/contentCreator/services/apply.js";
import { normalizeContentCreatorConfig } from "../../modules/contentCreator/services/config.js";

export function registerCreatorRoutes(router, { client }) {
  router.get("/api/guilds/:guildId/creators", (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.lead);

    const config = normalizeContentCreatorConfig(
      client.botContext.settingsStore.getModuleState(ctx.params.guildId, "content-creator")?.config
    );

    sendJson(ctx.res, 200, {
      ...config,
      youtubeReady: Boolean(client.botContext.env.youtubeApiKey),
      twitchReady: Boolean(client.botContext.env.twitchClientId && client.botContext.env.twitchClientSecret)
    });
  });

  // Profile werden serverseitig gegen die YouTube-/Twitch-API aufgelöst,
  // damit im Dashboard ein Kanalname oder Link genügt.
  router.post("/api/guilds/:guildId/creators", async (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.admin);

    const result = await applyCreatorConfig(client, ctx.params.guildId, ctx.body);

    recordAudit({
      guildId: ctx.params.guildId,
      actorId: ctx.session.discordId,
      actorName: ctx.session.username,
      action: "creators.update",
      detail: {
        youtube: result.config.youtubeChannels.length,
        twitch: result.config.twitchChannels.length
      }
    });

    sendJson(ctx.res, 200, result);
  });
}
