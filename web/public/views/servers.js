import { ACCESS, api } from "../lib/api.js";
import {
  badge,
  card,
  clear,
  confirmDialog,
  field,
  formatDuration,
  formatRelative,
  h,
  modal,
  spinner,
  table,
  toast
} from "../lib/ui.js";
import { barChart, lineChart } from "../lib/charts.js";

const RANGES = [
  { id: "1h", label: "1 h" },
  { id: "6h", label: "6 h" },
  { id: "24h", label: "24 h" },
  { id: "7d", label: "7 T" },
  { id: "30d", label: "30 T" },
  { id: "90d", label: "90 T" }
];

const rangeState = new Map();

function statusBadge(summary) {
  const current = summary.current;
  if (!current) {
    return badge("keine Daten", "neutral");
  }

  if (current.stale) {
    return badge("veraltet", "warning");
  }

  return current.online ? badge("online", "success") : badge("offline", "danger");
}

function meter(percent) {
  const safe = Math.max(0, Math.min(100, Number(percent || 0)));
  return h("div.row", { style: { gap: "8px" } },
    h("div.bar-meter", { style: { flex: "1" } }, h("div", { style: { width: `${safe}%` } })),
    h("span.muted", { style: { fontSize: "12px" } }, `${safe} %`));
}

function serverForm(kinds, values = {}) {
  return h("div", {},
    field("Anzeigename", h("input.input", { name: "name", required: true, value: values.name || "", placeholder: "DarkRP Hauptserver" })),
    h("div.field-row", {},
      field("Typ", h("select.input", { name: "kind" },
        ...kinds.map((kind) => h("option", {
          value: kind.id,
          selected: kind.id === (values.kind || "source")
        }, kind.label)))),
      field("Abtastrate (Sek.)", h("input.input", {
        name: "intervalSeconds", type: "number", min: 15, max: 3600,
        value: values.intervalSeconds || 30
      }), "15–3600, Standard 30")),
    h("div.field-row", {},
      field("Host / IP", h("input.input", { name: "host", required: true, value: values.host || "", placeholder: "gmod.example.de" })),
      field("Port", h("input.input", { name: "port", type: "number", min: 1, max: 65535, value: values.port || 27015 }))),
    h("div.field-row", {},
      field("Query-Port (optional)", h("input.input", {
        name: "queryPort", type: "number", min: 1, max: 65535, value: values.queryPort || ""
      }), "Leer = wie Port"),
      field("Diagrammfarbe", h("input.input", { name: "color", type: "color", value: values.color || "#5865f2" }))),
    field("Connect-Link (optional)", h("input.input", {
      name: "connectUrl", value: values.connectUrl || "", placeholder: "steam://connect/…"
    }), "Leer = automatisch aus Typ und Adresse"));
}

function toServerPayload(data) {
  return {
    name: data.name,
    kind: data.kind,
    host: data.host,
    port: Number(data.port) || undefined,
    queryPort: data.queryPort ? Number(data.queryPort) : undefined,
    intervalSeconds: Number(data.intervalSeconds) || 30,
    color: data.color,
    connectUrl: data.connectUrl
  };
}

async function openServerModal(guildId, kinds, existing, onDone) {
  modal(existing ? `${existing.name} bearbeiten` : "Server hinzufügen",
    serverForm(kinds, existing || {}), {
      submitLabel: existing ? "Speichern" : "Hinzufügen",
      onSubmit: async (data) => {
        const payload = toServerPayload(data);

        if (existing) {
          await api.updateServer(guildId, existing.id, payload);
          toast("Server aktualisiert.", "success");
        } else {
          await api.createServer(guildId, payload);
          toast("Server wird jetzt überwacht.", "success");
        }

        await onDone();
      }
    });
}

async function openTokenModal(guildId, serverId, serverName) {
  const container = h("div", {}, spinner("Token wird erzeugt …"));

  const overlay = modal(`Ingest-Token · ${serverName}`, container, {
    submitLabel: "Fertig",
    onSubmit: async () => {}
  });

  try {
    const { token } = await api.createIngestToken(guildId, serverId, "Dashboard");
    const base = window.location.origin;

    clear(container).append(
      h("p", {}, "Dieser Token wird nur einmal angezeigt. Trage ihn im Spielserver-Addon ein – damit meldet der Server SteamIDs und Spielzeiten an den Bot."),
      h("pre.code-block", {}, token),
      h("p.muted", { style: { fontSize: "13px" } }, "Endpunkte:"),
      h("pre.code-block", {}, [
        `POST ${base}/api/ingest/players`,
        `POST ${base}/api/ingest/link`,
        "Header: x-ingest-token: <Token>"
      ].join("\n")),
      h("p.muted", { style: { fontSize: "13px" } },
        "Das fertige Garry's-Mod-Addon liegt im Repo unter ", h("code", {}, "addons/gmod-bot-bridge"), "."));
  } catch (error) {
    clear(container).append(h("p", {}, error.message));
  }

  return overlay;
}

function serverCard(guildId, guild, summary, refresh) {
  const server = summary.server;
  const current = summary.current;
  const isAdmin = guild.accessLevel >= ACCESS.ADMIN;
  const isLead = guild.accessLevel >= ACCESS.LEAD;

  const chartHost = h("div", {}, spinner("Verlauf wird geladen …"));
  const range = rangeState.get(server.id) || "24h";

  async function loadChart(selected) {
    rangeState.set(server.id, selected);
    clear(chartHost).append(spinner());

    try {
      const series = await api.series(guildId, server.id, selected);
      clear(chartHost).append(
        lineChart(series.points, { color: server.color }),
        h("div.chart-legend", {},
          h("span", {}, h("span.legend-swatch", { style: { background: server.color } }), "Ø Spieler"),
          h("span", {}, h("span.legend-swatch", { style: { background: "var(--text-muted)" } }), "Peak"),
          h("span", {}, h("span.legend-swatch", { style: { background: "var(--danger)" } }), "Slots"),
          h("span", {}, h("span.legend-swatch", { style: { background: "rgba(237,66,69,0.35)" } }), "Offline")));
    } catch (error) {
      clear(chartHost).append(h("p.muted", {}, error.message));
    }
  }

  const rangePills = h("div.pill-group", {}, ...RANGES.map((entry) =>
    h("button.pill", {
      class: entry.id === range ? "active" : "",
      onClick: (event) => {
        for (const pill of rangePills.children) {
          pill.classList.remove("active");
        }

        event.target.classList.add("active");
        loadChart(entry.id);
      }
    }, entry.label)));

  loadChart(range);

  const facts = [
    ["Status", statusBadge(summary)],
    ["Adresse", h("span.mono", {}, `${server.host}:${server.port}`)],
    ["Spieler", current?.online ? `${current.players} / ${current.maxPlayers}` : "–"],
    ["Auslastung", summary.fillPercent === null ? "–" : meter(summary.fillPercent)],
    ["Map", current?.map ? h("span.mono", {}, current.map) : "–"],
    ["Ping", current?.latencyMs ? `${current.latencyMs} ms` : "–"],
    ["Ø / Peak 24 h", `${summary.averages.last24h} / ${summary.peaks.last24h.peak}`],
    ["Ø / Peak 7 T", `${summary.averages.last7d} / ${summary.peaks.last7d.peak}`],
    ["Ø / Peak 30 T", `${summary.averages.last30d} / ${summary.peaks.last30d.peak}`],
    ["Uptime 24 h / 7 T / 30 T", [summary.uptime.last24h, summary.uptime.last7d, summary.uptime.last30d]
      .map((value) => (value === null ? "–" : `${value} %`)).join(" / ")],
    ["Trend vs. Vortag", summary.trendPercent === null
      ? "–"
      : badge(`${summary.trendPercent > 0 ? "+" : ""}${summary.trendPercent} %`,
        summary.trendPercent > 2 ? "success" : summary.trendPercent < -2 ? "danger" : "neutral")],
    ["Primetime", summary.bestHour ? `${String(summary.bestHour.hour).padStart(2, "0")}:00 · Ø ${summary.bestHour.average}` : "–"],
    ["Einzelspieler 7 T / 30 T", `${summary.uniquePlayers.last7d} / ${summary.uniquePlayers.last30d}`],
    ["Abtastrate", `alle ${server.intervalSeconds} s`],
    ["Letzte Messung", formatRelative(current?.takenAt)]
  ];

  return card(
    h("div.row-between", { style: { width: "100%" } },
      h("div.server-head", {},
        h("span.dot", { class: current?.online && !current?.stale ? "online" : "offline" }),
        h("strong", {}, server.name),
        !server.enabled ? badge("pausiert", "neutral") : null),
      h("div.row", {},
        isLead
          ? h("button.btn.btn-sm", {
            onClick: async (event) => {
              event.target.disabled = true;
              try {
                const probe = await api.probe(guildId, server.id);
                toast(probe.online
                  ? `Antwort: ${probe.players}/${probe.maxPlayers} Spieler, ${probe.latencyMs} ms`
                  : "Server antwortet nicht.", probe.online ? "success" : "error");
                await refresh();
              } finally {
                event.target.disabled = false;
              }
            }
          }, "Jetzt abfragen")
          : null,
        isAdmin
          ? h("button.btn.btn-sm", {
            onClick: () => openServerModal(guildId, window.__serverKinds || [], server, refresh)
          }, "Bearbeiten")
          : null,
        isAdmin
          ? h("button.btn.btn-sm", {
            onClick: () => openTokenModal(guildId, server.id, server.name)
          }, "Ingest-Token")
          : null,
        isAdmin
          ? h("button.btn.btn-sm.btn-danger", {
            onClick: async () => {
              if (!confirmDialog(`„${server.name}“ inklusive aller Verlaufsdaten löschen?`)) {
                return;
              }

              await api.deleteServer(guildId, server.id);
              toast("Server entfernt.", "success");
              await refresh();
            }
          }, "Löschen")
          : null)),

    h("div.row-between", { style: { marginBottom: "10px" } },
      h("span.muted", { style: { fontSize: "13px" } }, "Spielerverlauf"),
      rangePills),
    chartHost,

    h("div.grid.grid-2", { style: { marginTop: "18px" } },
      table(["Kennzahl", "Wert"], facts, {}),
      h("div.stack", {},
        summary.hourProfile?.some((entry) => entry.average > 0)
          ? h("div", {},
            h("div.muted", { style: { fontSize: "13px", marginBottom: "6px" } }, "Aktivität nach Uhrzeit (14 Tage)"),
            barChart(summary.hourProfile.map((entry) => ({
              label: String(entry.hour).padStart(2, "0"),
              value: entry.average
            })), { height: 150, color: server.color }))
          : null,
        summary.weekdayProfile?.some((entry) => entry.average > 0)
          ? h("div", {},
            h("div.muted", { style: { fontSize: "13px", marginBottom: "6px" } }, "Aktivität nach Wochentag (28 Tage)"),
            barChart(summary.weekdayProfile.map((entry) => ({
              label: entry.label,
              value: entry.average
            })), { height: 130, color: server.color }))
          : null,
        summary.topMaps?.length > 0
          ? h("div", {},
            h("div.muted", { style: { fontSize: "13px", marginBottom: "6px" } }, "Meistgespielte Maps (7 Tage)"),
            table(["Map", "Ø", "Peak"], summary.topMaps.slice(0, 6).map((entry) => [
              h("span.mono", {}, entry.map), String(entry.average), String(entry.peak)
            ])))
          : null,
        summary.topPlayers?.length > 0
          ? h("div", {},
            h("div.muted", { style: { fontSize: "13px", marginBottom: "6px" } }, "Top-Spielzeit (30 Tage)"),
            table(["Spieler", "Spielzeit"], summary.topPlayers.slice(0, 8).map((player) => [
              player.name || player.steamId, formatDuration(player.seconds)
            ])))
          : null)));
}

export async function renderServers({ guildId, guild }) {
  const container = h("div.stack");

  async function refresh() {
    const [servers, kinds] = await Promise.all([
      api.servers(guildId),
      window.__serverKinds ? Promise.resolve(window.__serverKinds) : api.serverKinds()
    ]);

    window.__serverKinds = kinds;

    clear(container).append(
      h("div.page-header", {},
        h("h1", {}, "Server-Monitoring"),
        h("div.page-actions", {},
          guild.accessLevel >= ACCESS.LEAD
            ? h("button.btn", {
              onClick: async () => {
                await api.post(`/api/guilds/${guildId}/panel/refresh`);
                toast("Discord-Panel wurde aktualisiert.", "success");
              }
            }, "Discord-Panel aktualisieren")
            : null,
          guild.accessLevel >= ACCESS.ADMIN
            ? h("button.btn.btn-primary", {
              onClick: () => openServerModal(guildId, kinds, null, refresh)
            }, "+ Server hinzufügen")
            : null)),

      servers.length === 0
        ? card("Noch keine Server",
          h("p.muted", {}, "Füge deinen ersten Server hinzu – Source/Garry's Mod, Minecraft, FiveM, ein HTTP-Endpunkt oder ein einfacher TCP-Port. Neue Server werden sofort ohne Neustart überwacht."))
        : h("div.stack", {}, ...servers.map((summary) => serverCard(guildId, guild, summary, refresh))));
  }

  await refresh();
  return container;
}
