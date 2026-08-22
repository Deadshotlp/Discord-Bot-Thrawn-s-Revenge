import { api } from "../lib/api.js";
import { badge, button, card, clear, formatDate, h, spinner, stat, toast } from "../lib/ui.js";

function memberRow(entry) {
  return h("div.roster-member", {},
    entry.avatarUrl
      ? h("img.roster-avatar", { src: entry.avatarUrl, alt: "" })
      : h("div.roster-avatar.roster-avatar-empty", {}, (entry.name || "?").slice(0, 1).toUpperCase()),

    h("div.roster-identity", {},
      h("div.roster-name", {}, entry.name),
      entry.username ? h("div.roster-handle", {}, `@${entry.username}`) : null),

    h("div.roster-tags", {},
      entry.isLead ? badge("👑 Leitung", "warning") : null,
      entry.absence
        ? badge(`${entry.absence.emoji} ${entry.absence.label} bis ${formatDate(entry.absence.endsOn)}`, "danger")
        : badge("verfügbar", "success")));
}

function departmentCard(group) {
  if (group.unconfigured) {
    return card(group.name,
      h("p.muted", {}, "Diesem Department sind noch keine Rollen zugeordnet."));
  }

  const summary = h("div.roster-summary", {},
    h("span", {}, `${group.members.length} Mitglieder`),
    group.leadCount > 0 ? h("span", {}, `${group.leadCount} Leitung`) : null,
    group.absentCount > 0 ? h("span.roster-summary-absent", {}, `${group.absentCount} abgemeldet`) : null);

  return card(group.name,
    summary,
    group.members.length > 0
      ? h("div.roster-list", {}, ...group.members.map(memberRow))
      : h("p.muted", {}, "Niemand trägt eine Rolle dieses Departments."));
}

export async function renderRoster({ guildId }) {
  const container = h("div.stack");

  async function refresh({ force = false } = {}) {
    clear(container).append(spinner("Teamliste wird geladen …"));

    let roster;

    try {
      roster = await api.teamRoster(guildId, { refresh: force });
    } catch (error) {
      clear(container).append(
        h("div.page-header", {}, h("h1", {}, "Teamliste")),
        card("Fehler", h("p.muted", {}, error.message)));
      return;
    }

    if (force) {
      toast("Teamliste aktualisiert", "success");
    }

    const header = h("div.page-header", {},
      h("h1", {}, "Teamliste"),
      h("div.page-actions", {},
        button("Aktualisieren", { onClick: () => refresh({ force: true }) })));

    if (roster.unavailable) {
      clear(container).append(header,
        card("Mitgliederliste nicht verfügbar",
          h("p", {}, roster.unavailable),
          h("p.muted", {},
            "Nach dem Umstellen muss der Bot neu gestartet werden.")));
      return;
    }

    if (roster.departments.length === 0) {
      clear(container).append(header,
        card("Keine Departments",
          h("p.muted", {},
            "Departments werden unter Einstellungen angelegt. Erst dann lässt sich das Team gruppieren.")));
      return;
    }

    clear(container).append(header,
      h("div.grid.grid-4", {},
        stat("Personen im Team", String(roster.totals.members)),
        stat("Leitung", String(roster.totals.leads)),
        stat("Aktuell abgemeldet", String(roster.totals.absent)),
        stat("Departments", String(roster.departments.filter((group) => !group.unconfigured).length))),

      ...roster.departments.map(departmentCard),

      card("Hinweis",
        h("p.muted", {},
          "Wer zu einem Department gehört, ergibt sich aus den Rollen, die unter Einstellungen "
          + "hinterlegt sind – als Bereichsrolle oder als Leitungsrolle. Abmeldungen stammen aus "
          + "dem Modul Team-Abmeldungen und zeigen nur, wer heute abwesend ist.")));
  }

  await refresh();
  return container;
}
