import { api } from "../lib/api.js";
import { card, formatDateTime, h, table } from "../lib/ui.js";

const ACTION_LABELS = {
  "module.update": "Modul geändert",
  "department.create": "Department angelegt",
  "department.delete": "Department gelöscht",
  "monitor.server.create": "Server hinzugefügt",
  "monitor.server.update": "Server geändert",
  "monitor.server.delete": "Server entfernt",
  "monitor.token.create": "Ingest-Token erzeugt",
  "absence.create": "Abmeldung eingetragen",
  "absence.cancel": "Abmeldung zurückgezogen",
  "absence.approve": "Abmeldung freigegeben",
  "absence.reject": "Abmeldung abgelehnt",
  "absence.delete": "Abmeldung gelöscht",
  "meeting.create": "Meeting angelegt",
  "meeting.delete": "Meeting gelöscht",
  "steam.link.manual": "Steam manuell verknüpft",
  "steam.link.openid": "Steam über Login verknüpft",
  "steam.unlink": "Steam-Verknüpfung entfernt",
  "creators.update": "Creator-Konfiguration geändert"
};

function formatDetail(detail) {
  const entries = Object.entries(detail || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`);

  return entries.length > 0 ? entries.join(", ") : "–";
}

export async function renderAudit({ guildId }) {
  const entries = await api.audit(guildId);

  return h("div.stack", {},
    h("div.page-header", {}, h("h1", {}, "Protokoll")),
    card("Letzte Änderungen",
      table(["Zeitpunkt", "Wer", "Aktion", "Details"],
        entries.map((entry) => [
          formatDateTime(entry.createdAt),
          entry.actorName || entry.actorId || "System",
          ACTION_LABELS[entry.action] || entry.action,
          h("span.muted", { style: { fontSize: "12px" } }, formatDetail(entry.detail))
        ]),
        { empty: "Noch keine Einträge." })));
}
