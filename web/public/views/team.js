import { api } from "../lib/api.js";
import { card, clear, formatMs, h, select, spinner, stat, table } from "../lib/ui.js";
import { barChart } from "../lib/charts.js";

export async function renderTeam({ guildId }) {
  const container = h("div.stack");
  let days = 30;

  async function refresh() {
    clear(container).append(spinner());

    const [team, support] = await Promise.all([
      api.teamStats(guildId, days),
      api.supportStats(guildId, days).catch(() => null)
    ]);

    const departmentName = (id) =>
      team.departments.find((department) => department.id === id)?.name || id;

    const totalHandled = team.members.reduce((sum, member) => sum + member.handled, 0);
    const active = team.members.filter((member) => member.handled > 0);

    clear(container).append(
      h("div.page-header", {},
        h("h1", {}, "Team-Statistiken"),
        h("div.page-actions", {},
          select([
            { value: "7", label: "7 Tage" },
            { value: "30", label: "30 Tage" },
            { value: "90", label: "90 Tage" },
            { value: "365", label: "1 Jahr" }
          ], {
            value: String(days),
            onChange: (event) => { days = Number(event.target.value); refresh(); }
          }))),

      h("div.grid.grid-4", {},
        stat("Bearbeitete Vorgänge", String(totalHandled), `${days} Tage`),
        stat("Aktive Teammitglieder", String(active.length)),
        stat("Ø pro Mitglied", active.length > 0 ? String(Math.round((totalHandled / active.length) * 10) / 10) : "0"),
        support
          ? stat("Ø Bearbeitungsdauer", support.tickets.averageDurationMs ? formatMs(support.tickets.averageDurationMs) : "–")
          : null),

      active.length > 0
        ? card("Bearbeitete Vorgänge je Mitglied",
          barChart(active.slice(0, 20).map((member) => ({
            label: (team.users[member.userId]?.name || member.userId).slice(0, 10),
            value: member.handled
          })), { height: 210 }))
        : null,

      card("Detailübersicht",
        table(
          ["#", "Mitglied", "Bearbeitet", "Tickets geschlossen", "Fälle übernommen", "Fälle geschlossen", "Eskalationen", "Departments"],
          team.members.map((member, index) => [
            String(index + 1),
            h("div.user-cell", {},
              team.users[member.userId]?.avatarUrl
                ? h("img", { src: team.users[member.userId].avatarUrl, alt: "" })
                : null,
              team.users[member.userId]?.name || member.userId),
            h("strong", {}, String(member.handled)),
            String(member.ticketsClosed),
            String(member.casesClaimed),
            String(member.casesClosed),
            String(member.ticketsEscalated),
            Object.entries(member.departments)
              .map(([id, count]) => `${departmentName(id)} (${count})`)
              .join(", ") || "–"
          ]),
          { empty: "Für diesen Zeitraum liegen keine Team-Aktivitäten vor." })),

      card("Hinweis",
        h("p.muted", {},
          "Gezählt werden Vorgänge, die der Bot beobachtet: geschlossene Tickets, übernommene und geschlossene Sprach-Fälle sowie Eskalationen. Vorgänge aus der Zeit vor diesem Update fehlen in der Statistik.")));
  }

  await refresh();
  return container;
}
