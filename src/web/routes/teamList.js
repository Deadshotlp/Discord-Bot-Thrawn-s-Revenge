import { sendJson } from "../http.js";
import { MemberIntentError, collectRoster } from "../../modules/teamList/services/roster.js";

export function registerTeamListRoutes(router, { client }) {
  router.get("/api/guilds/:guildId/team/roster", async (ctx) => {
    const force = ctx.url.searchParams.get("refresh") === "1";

    try {
      sendJson(ctx.res, 200, await collectRoster(client, ctx.params.guildId, { force }));
    } catch (error) {
      if (error instanceof MemberIntentError) {
        // Kein Fehlerstatus: das Dashboard soll den Hinweis anzeigen können,
        // statt nur eine rote Meldung zu bekommen.
        sendJson(ctx.res, 200, {
          departments: [],
          totals: { members: 0, absent: 0, leads: 0 },
          unavailable: error.message
        });
        return;
      }

      throw error;
    }
  });
}
