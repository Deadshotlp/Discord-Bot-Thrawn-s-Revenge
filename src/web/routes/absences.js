import { ACCESS_LEVELS, requireLevel } from "../auth.js";
import { HttpError, sendJson } from "../http.js";
import { recordAudit } from "../../core/audit.js";
import { announceAbsence, refreshOverview } from "../../modules/absence/services/announce.js";
import { normalizeAbsenceConfig } from "../../modules/absence/services/config.js";
import { getDepartments, getMemberDepartments } from "../../modules/absence/services/departments.js";
import {
  ABSENCE_KINDS,
  ABSENCE_STATUS,
  createAbsence,
  deleteAbsence,
  getAbsence,
  listAbsences,
  setAbsenceStatus,
  updateAbsence
} from "../../modules/absence/services/store.js";

function canManageAbsence(access, absence) {
  if (access.level >= ACCESS_LEVELS.admin) {
    return true;
  }

  if (absence.userId === access.member?.id) {
    return true;
  }

  return access.leadDepartments.some((departmentId) => absence.departmentIds.includes(departmentId));
}

export function registerAbsenceRoutes(router, { client }) {
  router.get("/api/absence-kinds", (ctx) => {
    sendJson(ctx.res, 200, Object.values(ABSENCE_KINDS));
  });

  router.get("/api/guilds/:guildId/absences", async (ctx) => {
    const all = listAbsences(ctx.params.guildId);
    const isStaff = ctx.access.level >= ACCESS_LEVELS.staff;
    const visible = isStaff ? all : all.filter((absence) => absence.userId === ctx.session.discordId);

    const guild = ctx.access.guild;
    const users = {};
    for (const absence of visible) {
      if (users[absence.userId]) {
        continue;
      }

      const member = guild.members.cache.get(absence.userId)
        || await guild.members.fetch(absence.userId).catch(() => null);

      users[absence.userId] = {
        id: absence.userId,
        name: member?.displayName || absence.userId,
        avatarUrl: member?.displayAvatarURL({ size: 64 }) || ""
      };
    }

    sendJson(ctx.res, 200, {
      absences: visible,
      users,
      departments: getDepartments(client, ctx.params.guildId),
      canManageAll: ctx.access.level >= ACCESS_LEVELS.lead
    });
  });

  router.post("/api/guilds/:guildId/absences", async (ctx) => {
    const config = normalizeAbsenceConfig(
      client.botContext.settingsStore.getModuleState(ctx.params.guildId, "absence")?.config
    );

    const targetUserId = ctx.body.userId && ctx.body.userId !== ctx.session.discordId
      ? String(ctx.body.userId)
      : ctx.session.discordId;

    if (targetUserId !== ctx.session.discordId) {
      requireLevel(ctx.access, ACCESS_LEVELS.lead);
    }

    const departments = getDepartments(client, ctx.params.guildId);
    const departmentIds = Array.isArray(ctx.body.departmentIds) && ctx.body.departmentIds.length > 0
      ? ctx.body.departmentIds.map(String)
      : getMemberDepartments(ctx.access.member, departments).map((department) => department.id);

    let absence;
    try {
      absence = createAbsence({
        guildId: ctx.params.guildId,
        userId: targetUserId,
        departmentIds,
        startsOn: ctx.body.startsOn,
        endsOn: ctx.body.endsOn || ctx.body.startsOn,
        kind: ctx.body.kind,
        reason: ctx.body.reason,
        status: config.requireApproval && ctx.access.level < ACCESS_LEVELS.lead
          ? ABSENCE_STATUS.pending
          : ABSENCE_STATUS.active,
        createdBy: ctx.session.discordId
      });
    } catch (error) {
      throw new HttpError(400, error.message);
    }

    recordAudit({
      guildId: ctx.params.guildId,
      actorId: ctx.session.discordId,
      actorName: ctx.session.username,
      action: "absence.create",
      detail: { absenceId: absence.id, userId: targetUserId }
    });

    await announceAbsence(client, absence, { action: "created" }).catch(() => null);
    await refreshOverview(client, ctx.params.guildId).catch(() => null);

    sendJson(ctx.res, 201, absence);
  });

  router.patch("/api/guilds/:guildId/absences/:absenceId", async (ctx) => {
    const absence = getAbsence(ctx.params.absenceId);
    if (!absence || absence.guildId !== ctx.params.guildId) {
      throw new HttpError(404, "Eintrag nicht gefunden");
    }

    if (!canManageAbsence(ctx.access, absence)) {
      throw new HttpError(403, "Keine Berechtigung für diesen Eintrag");
    }

    let updated = absence;

    if (ctx.body.status && Object.values(ABSENCE_STATUS).includes(ctx.body.status)) {
      if (ctx.body.status !== ABSENCE_STATUS.cancelled) {
        requireLevel(ctx.access, ACCESS_LEVELS.lead);
      }

      updated = setAbsenceStatus(absence.id, ctx.body.status);
    }

    const hasFieldChanges = ["startsOn", "endsOn", "kind", "reason", "departmentIds"]
      .some((key) => ctx.body[key] !== undefined);

    if (hasFieldChanges) {
      try {
        updated = updateAbsence(absence.id, ctx.body);
      } catch (error) {
        throw new HttpError(400, error.message);
      }
    }

    await announceAbsence(client, updated, {
      action: ctx.body.status === ABSENCE_STATUS.cancelled ? "cancelled" : "updated"
    }).catch(() => null);
    await refreshOverview(client, ctx.params.guildId).catch(() => null);

    sendJson(ctx.res, 200, updated);
  });

  router.delete("/api/guilds/:guildId/absences/:absenceId", async (ctx) => {
    const absence = getAbsence(ctx.params.absenceId);
    if (!absence || absence.guildId !== ctx.params.guildId) {
      throw new HttpError(404, "Eintrag nicht gefunden");
    }

    if (!canManageAbsence(ctx.access, absence)) {
      throw new HttpError(403, "Keine Berechtigung für diesen Eintrag");
    }

    deleteAbsence(absence.id);
    recordAudit({
      guildId: ctx.params.guildId,
      actorId: ctx.session.discordId,
      actorName: ctx.session.username,
      action: "absence.delete",
      detail: { absenceId: absence.id }
    });

    await refreshOverview(client, ctx.params.guildId).catch(() => null);
    sendJson(ctx.res, 200, { ok: true });
  });
}
