import { ACCESS, api } from "../lib/api.js";
import {
  badge,
  card,
  clear,
  confirmDialog,
  field,
  formatDate,
  h,
  modal,
  select,
  spinner,
  stat,
  table,
  toast,
  todayIso
} from "../lib/ui.js";
import { timeline } from "../lib/charts.js";

let kindCache = null;

function kindLabel(kinds, id) {
  const kind = kinds.find((entry) => entry.id === id);
  return kind ? `${kind.emoji} ${kind.label}` : id;
}

function statusBadge(status) {
  return {
    active: badge("aktiv", "success"),
    pending: badge("wartet auf Freigabe", "warning"),
    cancelled: badge("zurückgezogen", "neutral"),
    rejected: badge("abgelehnt", "danger")
  }[status] || badge(status, "neutral");
}

function absenceForm(kinds, departments, values = {}, { allowUserPick = false, users = [] } = {}) {
  return h("div", {},
    allowUserPick
      ? field("Für wen", select(
        [{ value: "", label: "Für mich selbst" }, ...users],
        { name: "userId", value: values.userId || "" }
      ), "Leitung kann Abmeldungen auch für andere eintragen")
      : null,
    h("div.field-row", {},
      field("Von", h("input.input", { name: "startsOn", type: "date", required: true, value: values.startsOn || todayIso() })),
      field("Bis", h("input.input", { name: "endsOn", type: "date", required: true, value: values.endsOn || todayIso() }))),
    field("Art", select(kinds.map((kind) => ({ value: kind.id, label: `${kind.emoji} ${kind.label}` })), {
      name: "kind",
      value: values.kind || "abwesend"
    })),
    field("Bereich", select(
      [{ value: "", label: "Automatisch aus meinen Rollen" },
        ...departments.map((department) => ({ value: department.id, label: department.name }))],
      { name: "departmentId", value: values.departmentIds?.[0] || "" }
    ), "Bestimmt, wo die Abmeldung angekündigt wird"),
    field("Grund / Hinweis (optional)", h("textarea.input", {
      name: "reason", maxlength: 300, value: values.reason || ""
    })));
}

export async function renderAbsences({ guildId, guild, session }) {
  const container = h("div.stack");
  kindCache = kindCache || await api.absenceKinds();

  async function refresh() {
    clear(container).append(spinner());

    const data = await api.absences(guildId);
    const kinds = kindCache;
    const today = todayIso();

    const departmentName = (id) =>
      data.departments.find((department) => department.id === id)?.name || (id ? id : "Allgemein");

    const relevant = data.absences.filter((absence) =>
      absence.status !== "cancelled" && absence.status !== "rejected" && absence.endsOn >= today);

    const currentlyAway = relevant.filter((absence) =>
      absence.startsOn <= today && absence.status === "active");
    const pending = data.absences.filter((absence) => absence.status === "pending");

    // Zeitleiste nach Department gruppiert
    const groups = new Map();
    for (const absence of relevant) {
      const keys = absence.departmentIds.length > 0 ? absence.departmentIds : [""];
      for (const key of keys) {
        if (!groups.has(key)) {
          groups.set(key, new Map());
        }

        const byUser = groups.get(key);
        if (!byUser.has(absence.userId)) {
          byUser.set(absence.userId, []);
        }

        byUser.get(absence.userId).push(absence);
      }
    }

    const timelineSections = [...groups.entries()].map(([departmentId, byUser]) =>
      card(departmentName(departmentId),
        timeline([...byUser.entries()].map(([userId, entries]) => ({
          label: data.users[userId]?.name || userId,
          spans: entries.map((absence) => ({
            startsOn: absence.startsOn,
            endsOn: absence.endsOn,
            tone: absence.status === "pending" ? "pending" : absence.kind,
            text: kinds.find((kind) => kind.id === absence.kind)?.emoji || "",
            title: `${kindLabel(kinds, absence.kind)}: ${formatDate(absence.startsOn)} – ${formatDate(absence.endsOn)}${absence.reason ? ` (${absence.reason})` : ""}`
          }))
        })), { days: 28 })));

    const memberOptions = Object.values(data.users).map((user) => ({ value: user.id, label: user.name }));

    clear(container).append(
      h("div.page-header", {},
        h("h1", {}, "Team-Abmeldungen"),
        h("div.page-actions", {},
          h("button.btn.btn-primary", {
            onClick: () => modal("Abmeldung eintragen",
              absenceForm(kinds, data.departments, {}, {
                allowUserPick: guild.accessLevel >= ACCESS.LEAD,
                users: memberOptions
              }), {
                submitLabel: "Eintragen",
                onSubmit: async (formData) => {
                  await api.createAbsence(guildId, {
                    userId: formData.userId || undefined,
                    startsOn: formData.startsOn,
                    endsOn: formData.endsOn,
                    kind: formData.kind,
                    reason: formData.reason,
                    departmentIds: formData.departmentId ? [formData.departmentId] : []
                  });

                  toast("Abmeldung eingetragen.", "success");
                  await refresh();
                }
              })
          }, "+ Abmeldung eintragen"))),

      h("div.grid.grid-4", {},
        stat("Heute abgemeldet", String(currentlyAway.length)),
        stat("Geplant", String(relevant.length - currentlyAway.length)),
        stat("Offene Freigaben", String(pending.length)),
        stat("Departments", String(data.departments.length))),

      pending.length > 0 && guild.accessLevel >= ACCESS.LEAD
        ? card("Freigaben ausstehend",
          table(["Wer", "Zeitraum", "Art", "Bereich", ""],
            pending.map((absence) => [
              data.users[absence.userId]?.name || absence.userId,
              `${formatDate(absence.startsOn)} – ${formatDate(absence.endsOn)}`,
              kindLabel(kinds, absence.kind),
              absence.departmentIds.map(departmentName).join(", ") || "Allgemein",
              h("div.row", {},
                h("button.btn.btn-sm", {
                  onClick: async () => {
                    await api.updateAbsence(guildId, absence.id, { status: "active" });
                    toast("Freigegeben.", "success");
                    await refresh();
                  }
                }, "Freigeben"),
                h("button.btn.btn-sm.btn-danger", {
                  onClick: async () => {
                    await api.updateAbsence(guildId, absence.id, { status: "rejected" });
                    await refresh();
                  }
                }, "Ablehnen"))
            ])))
        : null,

      ...timelineSections,

      card("Alle Einträge",
        table(["Wer", "Zeitraum", "Tage", "Art", "Bereich", "Status", "Grund", ""],
          data.absences.slice(0, 200).map((absence) => {
            const mayEdit = guild.accessLevel >= ACCESS.LEAD || absence.userId === session.id;

            return [
              h("div.user-cell", {},
                data.users[absence.userId]?.avatarUrl
                  ? h("img", { src: data.users[absence.userId].avatarUrl, alt: "" })
                  : null,
                data.users[absence.userId]?.name || absence.userId),
              `${formatDate(absence.startsOn)} – ${formatDate(absence.endsOn)}`,
              String(absence.days),
              kindLabel(kinds, absence.kind),
              absence.departmentIds.map(departmentName).join(", ") || "Allgemein",
              statusBadge(absence.status),
              absence.reason || "–",
              mayEdit
                ? h("div.row", {},
                  h("button.btn.btn-sm", {
                    onClick: () => modal("Abmeldung bearbeiten",
                      absenceForm(kinds, data.departments, absence), {
                        onSubmit: async (formData) => {
                          await api.updateAbsence(guildId, absence.id, {
                            startsOn: formData.startsOn,
                            endsOn: formData.endsOn,
                            kind: formData.kind,
                            reason: formData.reason,
                            departmentIds: formData.departmentId ? [formData.departmentId] : []
                          });

                          toast("Gespeichert.", "success");
                          await refresh();
                        }
                      })
                  }, "Bearbeiten"),
                  h("button.btn.btn-sm.btn-danger", {
                    onClick: async () => {
                      if (!confirmDialog("Eintrag löschen?")) {
                        return;
                      }

                      await api.deleteAbsence(guildId, absence.id);
                      await refresh();
                    }
                  }, "Löschen"))
                : "–"
            ];
          }),
          { empty: "Noch keine Abmeldungen erfasst." })));
  }

  await refresh();
  return container;
}
