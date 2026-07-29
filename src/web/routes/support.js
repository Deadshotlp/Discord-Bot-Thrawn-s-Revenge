import { ACCESS_LEVELS, requireLevel } from "../auth.js";
import { HttpError, sendJson } from "../http.js";
import { buildTeamStats } from "../../core/staffEvents.js";
import { normalizeDepartments } from "../../modules/support/services/config.js";
import {
  getSupportTicket,
  getSupportTicketStats,
  listSupportTickets
} from "../../modules/support/services/tickets.js";
import { getSupportCaseStats, listSupportCases } from "../../modules/support/services/cases.js";
import { listWeeklyReportsForWeek } from "../../modules/weeklyReport/services/reports.js";
import { formatWeekLabel, getIsoWeekKey } from "../../modules/weeklyReport/services/week.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function parseRange(searchParams) {
  const days = Number(searchParams.get("days") || 30);
  const safeDays = Number.isFinite(days) ? Math.min(365, Math.max(1, days)) : 30;
  return { from: Date.now() - safeDays * DAY_MS, to: Date.now(), days: safeDays };
}

// Staff sieht nur die eigenen Departments, Leads ihre Bereiche, Admins alles.
function visibleDepartmentFilter(access) {
  if (access.level >= ACCESS_LEVELS.admin) {
    return null;
  }

  return new Set([...access.departments, ...access.leadDepartments]);
}

async function decorateUsers(guild, entries, keys) {
  const ids = new Set();
  for (const entry of entries) {
    for (const key of keys) {
      if (entry[key]) {
        ids.add(entry[key]);
      }
    }
  }

  const users = {};
  for (const id of ids) {
    const member = guild.members.cache.get(id) || await guild.members.fetch(id).catch(() => null);
    users[id] = {
      id,
      name: member?.displayName || member?.user?.username || id,
      avatarUrl: member?.displayAvatarURL({ size: 64 }) || ""
    };
  }

  return users;
}

export function registerSupportRoutes(router, { client }) {
  router.get("/api/guilds/:guildId/tickets", async (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.staff);

    const filter = visibleDepartmentFilter(ctx.access);
    let tickets = listSupportTickets(ctx.params.guildId, {
      status: ctx.url.searchParams.get("status") || "",
      departmentId: ctx.url.searchParams.get("department") || "",
      limit: Number(ctx.url.searchParams.get("limit") || 200)
    });

    if (filter) {
      tickets = tickets.filter((ticket) => filter.has(ticket.departmentId));
    }

    const departments = normalizeDepartments(
      client.botContext.settingsStore.getModuleState(ctx.params.guildId, "support")?.config?.departments
    );

    sendJson(ctx.res, 200, {
      tickets,
      departments,
      users: await decorateUsers(ctx.access.guild, tickets, ["userId", "closedById"])
    });
  });

  router.get("/api/guilds/:guildId/tickets/:ticketId", (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.staff);

    const ticket = getSupportTicket(ctx.params.guildId, ctx.params.ticketId);
    if (!ticket) {
      throw new HttpError(404, "Ticket nicht gefunden");
    }

    const filter = visibleDepartmentFilter(ctx.access);
    if (filter && !filter.has(ticket.departmentId)) {
      throw new HttpError(403, "Kein Zugriff auf dieses Department");
    }

    sendJson(ctx.res, 200, ticket);
  });

  router.get("/api/guilds/:guildId/cases", async (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.staff);

    const filter = visibleDepartmentFilter(ctx.access);
    let cases = listSupportCases(ctx.params.guildId, {
      status: ctx.url.searchParams.get("status") || "",
      limit: Number(ctx.url.searchParams.get("limit") || 200)
    });

    if (filter) {
      cases = cases.filter((entry) => filter.has(entry.departmentId));
    }

    sendJson(ctx.res, 200, {
      cases,
      users: await decorateUsers(ctx.access.guild, cases, ["userId", "supporterId"])
    });
  });

  router.get("/api/guilds/:guildId/stats/support", (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.staff);

    const range = parseRange(ctx.url.searchParams);
    sendJson(ctx.res, 200, {
      range,
      tickets: getSupportTicketStats(ctx.params.guildId, range.from),
      cases: getSupportCaseStats(ctx.params.guildId, range.from)
    });
  });

  router.get("/api/guilds/:guildId/stats/team", async (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.lead);

    const range = parseRange(ctx.url.searchParams);
    const stats = buildTeamStats(ctx.params.guildId, range);
    const departments = normalizeDepartments(
      client.botContext.settingsStore.getModuleState(ctx.params.guildId, "support")?.config?.departments
    );

    sendJson(ctx.res, 200, {
      range,
      departments,
      members: stats,
      users: await decorateUsers(ctx.access.guild, stats, ["userId"])
    });
  });

  router.get("/api/guilds/:guildId/weekly-reports", (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.lead);

    const week = ctx.url.searchParams.get("week") || getIsoWeekKey();
    const reports = listWeeklyReportsForWeek(ctx.params.guildId, week);

    sendJson(ctx.res, 200, {
      week,
      label: formatWeekLabel(week),
      reports
    });
  });
}
