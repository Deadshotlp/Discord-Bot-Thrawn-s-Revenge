import { api } from "../lib/api.js";
import {
  badge,
  card,
  clear,
  formatDateTime,
  formatMs,
  h,
  select,
  spinner,
  stat,
  table
} from "../lib/ui.js";
import { barChart } from "../lib/charts.js";

function userCell(users, userId) {
  const user = users[userId];
  if (!user) {
    return h("span.mono", {}, userId || "–");
  }

  return h("div.user-cell", {},
    user.avatarUrl ? h("img", { src: user.avatarUrl, alt: "" }) : null,
    user.name);
}

function statusBadge(status) {
  if (status === "open") {
    return badge("offen", "warning");
  }

  if (status === "claimed") {
    return badge("in Bearbeitung", "info");
  }

  return badge("geschlossen", "success");
}

export async function renderTickets({ guildId }) {
  const container = h("div.stack");
  const filters = { status: "", department: "", days: 30 };

  async function refresh() {
    clear(container).append(spinner());

    const query = new URLSearchParams();
    if (filters.status) {
      query.set("status", filters.status);
    }

    if (filters.department) {
      query.set("department", filters.department);
    }

    const [ticketData, caseData, stats] = await Promise.all([
      api.tickets(guildId, query.toString() ? `?${query}` : ""),
      api.cases(guildId).catch(() => ({ cases: [], users: {} })),
      api.supportStats(guildId, filters.days).catch(() => null)
    ]);

    const departmentName = (id) =>
      ticketData.departments.find((department) => department.id === id)?.name || id || "–";

    clear(container).append(
      h("div.page-header", {},
        h("h1", {}, "Tickets"),
        h("div.page-actions", {},
          select([
            { value: "", label: "Alle Status" },
            { value: "open", label: "Nur offene" },
            { value: "closed", label: "Nur geschlossene" }
          ], {
            value: filters.status,
            onChange: (event) => { filters.status = event.target.value; refresh(); }
          }),
          select([
            { value: "", label: "Alle Departments" },
            ...ticketData.departments.map((department) => ({ value: department.id, label: department.name }))
          ], {
            value: filters.department,
            onChange: (event) => { filters.department = event.target.value; refresh(); }
          }),
          select([
            { value: "7", label: "7 Tage" },
            { value: "30", label: "30 Tage" },
            { value: "90", label: "90 Tage" },
            { value: "365", label: "1 Jahr" }
          ], {
            value: String(filters.days),
            onChange: (event) => { filters.days = Number(event.target.value); refresh(); }
          }))),

      stats
        ? h("div.grid.grid-4", {},
          stat("Tickets gesamt", String(stats.tickets.total), `${filters.days} Tage`),
          stat("Offen", String(stats.tickets.open)),
          stat("Ø Bearbeitungsdauer", stats.tickets.averageDurationMs ? formatMs(stats.tickets.averageDurationMs) : "–"),
          stat("Sprach-Fälle", String(stats.cases.total),
            stats.cases.averageClaimWaitMs ? `Ø Wartezeit ${formatMs(stats.cases.averageClaimWaitMs)}` : null))
        : null,

      stats && stats.tickets.perDay.length > 0
        ? card("Tickets pro Tag",
          barChart(stats.tickets.perDay.map((entry) => ({
            label: entry.day.slice(8),
            value: entry.total
          })), { height: 170 }))
        : null,

      stats && stats.tickets.perDepartment.length > 0
        ? card("Verteilung nach Department",
          table(["Department", "Tickets"], stats.tickets.perDepartment.map((entry) => [
            departmentName(entry.departmentId), String(entry.total)
          ])))
        : null,

      card(`Tickets (${ticketData.tickets.length})`,
        table(
          ["Status", "Titel", "Ersteller", "Department", "Erstellt", "Geschlossen von", "Dauer"],
          ticketData.tickets.map((ticket) => [
            statusBadge(ticket.status),
            h("div", {},
              h("strong", {}, ticket.ticketName || "(ohne Titel)"),
              ticket.ticketDescription
                ? h("div.muted", { style: { fontSize: "12px" } }, ticket.ticketDescription.slice(0, 90))
                : null),
            userCell(ticketData.users, ticket.userId),
            departmentName(ticket.departmentId),
            formatDateTime(ticket.createdAt),
            ticket.closedById ? userCell(ticketData.users, ticket.closedById) : "–",
            ticket.closedAt ? formatMs(ticket.closedAt - ticket.createdAt) : "–"
          ]),
          { empty: "Keine Tickets im gewählten Filter." })),

      card(`Sprach-Fälle (${caseData.cases.length})`,
        table(
          ["Status", "Nutzer", "Supporter", "Department", "Erstellt", "Wartezeit"],
          caseData.cases.slice(0, 100).map((entry) => [
            statusBadge(entry.status),
            userCell(caseData.users, entry.userId),
            entry.supporterId ? userCell(caseData.users, entry.supporterId) : "–",
            departmentName(entry.departmentId),
            formatDateTime(entry.createdAt),
            entry.claimedAt ? formatMs(entry.claimedAt - entry.createdAt) : "–"
          ]),
          { empty: "Keine Sprach-Fälle." })));
  }

  await refresh();
  return container;
}
