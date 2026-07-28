import { ACCESS, api } from "./lib/api.js";
import { clear, h, spinner, toast } from "./lib/ui.js";

import { renderOverview } from "./views/overview.js";
import { renderServers } from "./views/servers.js";
import { renderTickets } from "./views/tickets.js";
import { renderTeam } from "./views/team.js";
import { renderAbsences } from "./views/absences.js";
import { renderMeetings } from "./views/meetings.js";
import { renderSteam } from "./views/steam.js";
import { renderSettings } from "./views/settings.js";
import { renderAudit } from "./views/audit.js";

const PAGES = [
  { id: "overview", label: "Übersicht", icon: "📊", level: ACCESS.MEMBER, render: renderOverview },
  { id: "servers", label: "Server-Monitoring", icon: "🖥️", level: ACCESS.MEMBER, render: renderServers },
  { id: "tickets", label: "Tickets", icon: "🎫", level: ACCESS.STAFF, render: renderTickets },
  { id: "team", label: "Team-Statistiken", icon: "🏅", level: ACCESS.LEAD, render: renderTeam },
  { id: "absences", label: "Abmeldungen", icon: "🌴", level: ACCESS.MEMBER, render: renderAbsences },
  { id: "meetings", label: "Meetings", icon: "📅", level: ACCESS.MEMBER, render: renderMeetings },
  { id: "steam", label: "Steam & Spielzeit", icon: "🎮", level: ACCESS.MEMBER, render: renderSteam },
  { id: "settings", label: "Einstellungen", icon: "⚙️", level: ACCESS.LEAD, render: renderSettings },
  { id: "audit", label: "Protokoll", icon: "📜", level: ACCESS.LEAD, render: renderAudit }
];

export const state = {
  session: null,
  guilds: [],
  guildId: "",
  guild: null,
  page: "overview"
};

function parseHash() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const parts = hash.split("?")[0].split("/").filter(Boolean);

  if (parts[0] === "g" && parts[1]) {
    return { guildId: parts[1], page: parts[2] || "overview" };
  }

  return { guildId: "", page: "" };
}

export function navigate(guildId, page) {
  window.location.hash = `#/g/${guildId}/${page}`;
}

function renderLogin(root) {
  clear(root).append(
    h("div.login", {},
      h("div.login-card", {},
        h("h1", {}, "Bot-Dashboard"),
        h("p.muted", {}, "Melde dich mit deinem Discord-Account an. Was du siehst, richtet sich nach deinen Rollen auf dem Server."),
        h("a.btn.btn-primary.btn-lg", { href: "/api/auth/login" }, "Mit Discord anmelden")))
  );
}

function renderGuildPicker(root) {
  clear(root).append(
    h("div.login", {},
      h("div.login-card", {},
        h("h1", {}, "Server wählen"),
        state.guilds.length === 0
          ? h("p.muted", {}, "Du hast auf keinem Server mit diesem Bot Zugriff. Bitte wende dich an die Serverleitung.")
          : h("div.guild-list", {}, ...state.guilds.map((guild) =>
            h("button.guild-item", { onClick: () => navigate(guild.id, "overview") },
              guild.icon
                ? h("img.guild-icon", { src: guild.icon, alt: "" })
                : h("span.guild-icon.placeholder", {}, guild.name.slice(0, 1)),
              h("span.guild-name", {}, guild.name),
              h("span.guild-role", {}, accessLabel(guild.accessLevel))))),
        h("button.btn.btn-ghost", { onClick: logout }, "Abmelden")))
  );
}

function accessLabel(level) {
  return { 4: "Admin", 3: "Leitung", 2: "Team", 1: "Mitglied" }[level] || "";
}

async function logout() {
  await api.logout().catch(() => null);
  window.location.hash = "";
  window.location.reload();
}

function renderShell(root, content) {
  const availablePages = PAGES.filter((page) => state.guild.accessLevel >= page.level);

  clear(root).append(
    h("div.layout", {},
      h("aside.sidebar", {},
        h("div.brand", {},
          state.guild.icon
            ? h("img.guild-icon", { src: state.guild.icon, alt: "" })
            : h("span.guild-icon.placeholder", {}, state.guild.name.slice(0, 1)),
          h("div", {},
            h("div.brand-name", {}, state.guild.name),
            h("div.brand-role", {}, accessLabel(state.guild.accessLevel)))),

        h("nav.nav", {}, ...availablePages.map((page) =>
          h("a.nav-item", {
            href: `#/g/${state.guildId}/${page.id}`,
            class: page.id === state.page ? "active" : ""
          }, h("span.nav-icon", {}, page.icon), page.label))),

        h("div.sidebar-footer", {},
          state.guilds.length > 1
            ? h("button.btn.btn-ghost.btn-sm", { onClick: () => { window.location.hash = ""; } }, "Server wechseln")
            : null,
          h("div.user", {},
            state.session.avatarUrl ? h("img.avatar", { src: state.session.avatarUrl, alt: "" }) : null,
            h("span", {}, state.session.displayName)),
          h("button.btn.btn-ghost.btn-sm", { onClick: logout }, "Abmelden"))),

      h("main.content", {}, content))
  );
}

async function render() {
  const root = document.getElementById("app");

  if (!state.session) {
    renderLogin(root);
    return;
  }

  const route = parseHash();

  if (!route.guildId) {
    if (state.guilds.length === 1) {
      navigate(state.guilds[0].id, "overview");
      return;
    }

    renderGuildPicker(root);
    return;
  }

  state.guildId = route.guildId;
  state.page = route.page;

  const guildMeta = state.guilds.find((guild) => guild.id === route.guildId);
  if (!guildMeta) {
    toast("Kein Zugriff auf diesen Server.", "error");
    window.location.hash = "";
    return;
  }

  const page = PAGES.find((entry) => entry.id === route.page) || PAGES[0];

  if (guildMeta.accessLevel < page.level) {
    navigate(route.guildId, "overview");
    return;
  }

  if (!state.guild || state.guild.id !== route.guildId) {
    renderShell(root, spinner("Server wird geladen …"));
    try {
      state.guild = await api.guild(route.guildId);
      state.guild.accessLevel = guildMeta.accessLevel;
      state.guild.leadDepartments = guildMeta.leadDepartments;
    } catch (error) {
      toast(error.message, "error");
      window.location.hash = "";
      return;
    }
  }

  const container = h("div.page");
  renderShell(root, container);
  container.append(spinner());

  try {
    const view = await page.render({ guildId: route.guildId, guild: state.guild, session: state.session });
    clear(container).append(view);
  } catch (error) {
    clear(container).append(
      h("div.card", {},
        h("h2.card-title", {}, "Fehler"),
        h("p", {}, error.message))
    );
  }
}

async function boot() {
  const root = document.getElementById("app");
  root.append(spinner("Anmeldung wird geprüft …"));

  try {
    const me = await api.me();
    if (me.authenticated) {
      state.session = me.user;
      state.guilds = me.guilds;
    }
  } catch {
    state.session = null;
  }

  window.addEventListener("hashchange", () => {
    render().catch((error) => toast(error.message, "error"));
  });

  await render();
}

boot().catch((error) => {
  document.getElementById("app").textContent = `Fehler beim Start: ${error.message}`;
});
