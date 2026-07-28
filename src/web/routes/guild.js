import { ChannelType } from "discord.js";
import { ACCESS_LEVELS, requireLevel } from "../auth.js";
import { HttpError, sendJson } from "../http.js";
import { listAudit, recordAudit } from "../../core/audit.js";
import {
  createUniqueDepartmentId,
  normalizeDepartments
} from "../../modules/support/services/config.js";

const CHANNEL_TYPES = {
  text: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
  voice: [ChannelType.GuildVoice, ChannelType.GuildStageVoice],
  category: [ChannelType.GuildCategory]
};

function serializeChannels(guild, kind = "text") {
  const allowed = CHANNEL_TYPES[kind] || CHANNEL_TYPES.text;

  return [...guild.channels.cache.values()]
    .filter((channel) => allowed.includes(channel.type))
    .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      parent: channel.parent?.name || ""
    }));
}

function serializeRoles(guild) {
  return [...guild.roles.cache.values()]
    .filter((role) => !role.managed && role.id !== guild.id)
    .sort((a, b) => b.position - a.position)
    .map((role) => ({
      id: role.id,
      name: role.name,
      color: role.hexColor
    }));
}

export function registerGuildRoutes(router, { client }) {
  router.get("/api/guilds/:guildId", (ctx) => {
    const { guild } = ctx.access;

    sendJson(ctx.res, 200, {
      id: guild.id,
      name: guild.name,
      icon: guild.iconURL({ size: 128 }) || "",
      memberCount: guild.memberCount,
      accessLevel: ctx.access.level,
      leadDepartments: ctx.access.leadDepartments,
      channels: {
        text: serializeChannels(guild, "text"),
        voice: serializeChannels(guild, "voice"),
        category: serializeChannels(guild, "category")
      },
      roles: serializeRoles(guild)
    });
  });

  router.get("/api/guilds/:guildId/modules", (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.lead);

    const { settingsStore, modules } = client.botContext;
    const guildConfig = settingsStore.getGuildConfig(ctx.params.guildId);

    sendJson(ctx.res, 200, modules.map((moduleDef) => ({
      name: moduleDef.name,
      label: moduleDef.label || moduleDef.name,
      description: moduleDef.description || "",
      enabled: Boolean(guildConfig.modules[moduleDef.name]?.enabled),
      config: guildConfig.modules[moduleDef.name]?.config || {},
      commands: (moduleDef.commands || []).map((command) => command.data.name)
    })));
  });

  router.patch("/api/guilds/:guildId/modules/:module", (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.admin);

    const { settingsStore } = client.botContext;
    const moduleName = ctx.params.module;

    if (!settingsStore.knownModules().includes(moduleName)) {
      throw new HttpError(404, "Unbekanntes Modul");
    }

    if (typeof ctx.body.enabled === "boolean") {
      settingsStore.setModuleEnabled(ctx.params.guildId, moduleName, ctx.body.enabled);
    }

    if (ctx.body.config && typeof ctx.body.config === "object") {
      settingsStore.setModuleConfig(ctx.params.guildId, moduleName, ctx.body.config);
    }

    recordAudit({
      guildId: ctx.params.guildId,
      actorId: ctx.session.discordId,
      actorName: ctx.session.username,
      action: "module.update",
      detail: { module: moduleName, enabled: ctx.body.enabled, keys: Object.keys(ctx.body.config || {}) }
    });

    sendJson(ctx.res, 200, settingsStore.getModuleState(ctx.params.guildId, moduleName));
  });

  router.get("/api/guilds/:guildId/departments", (ctx) => {
    const { settingsStore } = client.botContext;
    const config = settingsStore.getModuleState(ctx.params.guildId, "support")?.config;
    sendJson(ctx.res, 200, normalizeDepartments(config?.departments));
  });

  router.post("/api/guilds/:guildId/departments", (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.admin);

    const { settingsStore } = client.botContext;
    const config = settingsStore.getModuleState(ctx.params.guildId, "support")?.config || {};
    const departments = normalizeDepartments(config.departments);

    const name = String(ctx.body.name || "").trim();
    if (!name) {
      throw new HttpError(400, "Name fehlt");
    }

    const department = {
      id: createUniqueDepartmentId(departments, name),
      name,
      roleIds: Array.isArray(ctx.body.roleIds) ? ctx.body.roleIds.map(String) : [],
      leadRoleIds: Array.isArray(ctx.body.leadRoleIds) ? ctx.body.leadRoleIds.map(String) : []
    };

    const next = [...departments, department];
    settingsStore.setModuleConfig(ctx.params.guildId, "support", { departments: next });

    recordAudit({
      guildId: ctx.params.guildId,
      actorId: ctx.session.discordId,
      actorName: ctx.session.username,
      action: "department.create",
      detail: { departmentId: department.id, name }
    });

    sendJson(ctx.res, 201, department);
  });

  router.patch("/api/guilds/:guildId/departments/:departmentId", (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.admin);

    const { settingsStore } = client.botContext;
    const config = settingsStore.getModuleState(ctx.params.guildId, "support")?.config || {};
    const departments = normalizeDepartments(config.departments);
    const index = departments.findIndex((department) => department.id === ctx.params.departmentId);

    if (index === -1) {
      throw new HttpError(404, "Department nicht gefunden");
    }

    departments[index] = {
      ...departments[index],
      name: ctx.body.name === undefined ? departments[index].name : String(ctx.body.name).trim(),
      roleIds: ctx.body.roleIds === undefined ? departments[index].roleIds : ctx.body.roleIds.map(String),
      leadRoleIds: ctx.body.leadRoleIds === undefined
        ? departments[index].leadRoleIds
        : ctx.body.leadRoleIds.map(String)
    };

    settingsStore.setModuleConfig(ctx.params.guildId, "support", { departments });
    sendJson(ctx.res, 200, departments[index]);
  });

  router.delete("/api/guilds/:guildId/departments/:departmentId", (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.admin);

    const { settingsStore } = client.botContext;
    const config = settingsStore.getModuleState(ctx.params.guildId, "support")?.config || {};
    const departments = normalizeDepartments(config.departments)
      .filter((department) => department.id !== ctx.params.departmentId);

    settingsStore.setModuleConfig(ctx.params.guildId, "support", { departments });

    recordAudit({
      guildId: ctx.params.guildId,
      actorId: ctx.session.discordId,
      actorName: ctx.session.username,
      action: "department.delete",
      detail: { departmentId: ctx.params.departmentId }
    });

    sendJson(ctx.res, 200, { ok: true });
  });

  router.get("/api/guilds/:guildId/audit", (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.lead);
    sendJson(ctx.res, 200, listAudit(ctx.params.guildId, Number(ctx.url.searchParams.get("limit") || 100)));
  });

  router.get("/api/guilds/:guildId/members", async (ctx) => {
    requireLevel(ctx.access, ACCESS_LEVELS.staff);

    // Ohne das privilegierte Members-Intent ist der Cache leer, daher wird
    // immer über die REST-Suche gearbeitet.
    const query = String(ctx.url.searchParams.get("q") || "").trim();
    if (!query) {
      sendJson(ctx.res, 200, []);
      return;
    }

    const members = await ctx.access.guild.members
      .search({ query, limit: 25 })
      .catch(() => new Map());

    sendJson(ctx.res, 200, [...members.values()].slice(0, 50).map((member) => ({
      id: member.id,
      name: member.displayName,
      username: member.user.username,
      avatarUrl: member.displayAvatarURL({ size: 64 })
    })));
  });
}
