import { ACCESS, api } from "../lib/api.js";
import {
  card,
  clear,
  confirmDialog,
  formatDateTime,
  formatDuration,
  formatRelative,
  h,
  spinner,
  stat,
  table,
  toast
} from "../lib/ui.js";

export async function renderSteam({ guildId, guild }) {
  const container = h("div.stack");

  async function refresh() {
    clear(container).append(spinner());

    const [me, links] = await Promise.all([
      api.steamMe(guildId),
      guild.accessLevel >= ACCESS.LEAD ? api.steamLinks(guildId).catch(() => []) : Promise.resolve(null)
    ]);

    const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
    if (params.get("linked")) {
      toast("Steam-Account erfolgreich verknüpft.", "success");
    }

    clear(container).append(
      h("div.page-header", {}, h("h1", {}, "Steam & Spielzeit")),

      me.linked
        ? h("div.stack", {},
          h("div.grid.grid-4", {},
            stat("Spielzeit 30 Tage", formatDuration(me.playtime.seconds)),
            stat("Sitzungen", String(me.playtime.sessions)),
            stat("Zuletzt gesehen", me.playtime.lastSeen ? formatRelative(me.playtime.lastSeen) : "–"),
            stat("Verknüpft seit", formatDateTime(me.link.verifiedAt))),

          card("Deine Verknüpfung",
            table(["Feld", "Wert"], [
              ["SteamID64", h("span.mono", {}, me.link.steamId64)],
              ["Klassisch", h("span.mono", {}, me.link.classic)],
              ["Steam3", h("span.mono", {}, me.link.steam3)],
              ["Profil", h("a", { href: me.link.profileUrl, target: "_blank", rel: "noopener" }, me.link.profileUrl)],
              ["Quelle", me.link.source]
            ]),
            h("div.row", { style: { marginTop: "14px" } },
              h("a.btn", { href: `/api/auth/steam?guild=${guildId}` }, "Anderen Steam-Account verknüpfen"),
              h("button.btn.btn-danger", {
                onClick: async () => {
                  if (!confirmDialog("Verknüpfung wirklich aufheben? Bereits erfasste Spielzeit bleibt gespeichert.")) {
                    return;
                  }

                  await api.steamUnlinkMe(guildId);
                  toast("Verknüpfung aufgehoben.", "success");
                  await refresh();
                }
              }, "Verknüpfung aufheben"))),

          me.playtime.perServer.length > 0
            ? card("Spielzeit pro Server",
              table(["Server", "Spielzeit", "Sitzungen", "Zuletzt"],
                me.playtime.perServer.map((entry) => [
                  entry.serverName,
                  formatDuration(entry.seconds),
                  String(entry.sessions),
                  formatRelative(entry.lastSeen)
                ])))
            : null,

          me.sessions.length > 0
            ? card("Letzte Sitzungen",
              table(["Server", "Start", "Dauer", "Status"],
                me.sessions.map((session) => [
                  session.serverName,
                  formatDateTime(session.startedAt),
                  formatDuration(session.seconds),
                  session.endedAt ? "beendet" : "läuft"
                ])))
            : null)

        : card("Steam-Account verknüpfen",
          h("p", {}, "Verbinde deinen Steam-Account mit Discord, damit deine Spielzeit auf den Servern erfasst wird."),
          h("div.row", {},
            h("a.btn.btn-primary", { href: `/api/auth/steam?guild=${guildId}` }, "Über Steam anmelden")),
          h("p.muted", { style: { marginTop: "14px", fontSize: "13px" } },
            "Alternativ im Spiel: ", h("code", {}, "/steam verknuepfen"),
            " in Discord ausführen und den angezeigten Code im Spielchat eingeben.")),

      links
        ? card(`Verknüpfte Accounts (${links.length})`,
          table(["Mitglied", "SteamID", "Spielzeit 30 T", "Sitzungen", "Zuletzt", "Quelle", ""],
            links.map((link) => [
              h("div.user-cell", {},
                link.avatarUrl ? h("img", { src: link.avatarUrl, alt: "" }) : null,
                link.userName),
              h("a.mono", { href: link.profileUrl, target: "_blank", rel: "noopener" }, link.steamId64),
              formatDuration(link.playtimeSeconds),
              String(link.sessions),
              link.lastSeen ? formatRelative(link.lastSeen) : "–",
              link.source,
              guild.accessLevel >= ACCESS.ADMIN
                ? h("button.btn.btn-sm.btn-danger", {
                  onClick: async () => {
                    if (!confirmDialog(`Verknüpfung von ${link.userName} aufheben?`)) {
                      return;
                    }

                    await api.steamUnlink(guildId, link.discordId);
                    await refresh();
                  }
                }, "Trennen")
                : "–"
            ]),
            { empty: "Noch niemand hat seinen Steam-Account verknüpft." }))
        : null,

      card("Wie die Spielzeit erfasst wird",
        h("p.muted", {},
          "Über die A2S-Abfrage liefert ein Source-Server nur Spielernamen. Für SteamID-genaue Spielzeit meldet das Addon ",
          h("code", {}, "gmod-bot-bridge"),
          " die Spielerliste an den Bot. Den dafür nötigen Ingest-Token erzeugst du unter „Server-Monitoring“ beim jeweiligen Server. FiveM-Server liefern SteamIDs direkt über die HTTP-Schnittstelle – dort ist kein Addon nötig.")));
  }

  await refresh();
  return container;
}
