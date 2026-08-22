import { recordAudit } from "../../../core/audit.js";
import { normalizeAbsenceConfig } from "./config.js";
import { getDepartmentName, getDepartments, getMemberDepartments } from "./departments.js";
import { announceAbsence, formatDate, refreshOverview } from "./announce.js";
import {
  ABSENCE_STATUS,
  createAbsence,
  daysBetween,
  toIsoDate
} from "./store.js";

/**
 * Legt eine Abmeldung an – gemeinsam genutzt von /abmeldung melden und dem
 * Panel. Die Prüfungen liegen bewusst an einer Stelle, damit beide Wege
 * dieselben Regeln anwenden.
 *
 * @returns {Promise<{ ok: boolean, text: string, absence?: object }>}
 */
export async function submitAbsence({
  client,
  guildId,
  member,
  userId,
  von,
  bis,
  kind = "abwesend",
  reason = "",
  departmentId = ""
}) {
  const { settingsStore } = client.botContext;
  const config = normalizeAbsenceConfig(settingsStore.getModuleState(guildId, "absence")?.config);
  const departments = getDepartments(client, guildId);

  const startsOn = toIsoDate(von);
  const endsOn = toIsoDate(bis || von);

  if (!startsOn || !endsOn) {
    return {
      ok: false,
      text: "Datum konnte nicht gelesen werden. Nutze z. B. `24.12.2026` oder `2026-12-24`."
    };
  }

  if (endsOn < startsOn) {
    return { ok: false, text: "Das Enddatum liegt vor dem Startdatum." };
  }

  const length = daysBetween(startsOn, endsOn);
  if (length > config.maxDays) {
    return {
      ok: false,
      text: `Der Zeitraum ist länger als erlaubt (max. ${config.maxDays} Tage). Bitte an die Leitung wenden.`
    };
  }

  const departmentIds = departmentId
    ? [departmentId]
    : getMemberDepartments(member, departments).map((department) => department.id);

  let absence;

  try {
    absence = createAbsence({
      guildId,
      userId,
      departmentIds,
      startsOn,
      endsOn,
      kind,
      reason,
      status: config.requireApproval ? ABSENCE_STATUS.pending : ABSENCE_STATUS.active,
      createdBy: userId
    });
  } catch (error) {
    return { ok: false, text: error.message };
  }

  recordAudit({
    guildId,
    actorId: userId,
    actorName: member?.user?.username || userId,
    action: "absence.create",
    detail: { absenceId: absence.id, startsOn, endsOn }
  });

  await announceAbsence(client, absence, { action: "created" });
  await refreshOverview(client, guildId);

  return {
    ok: true,
    absence,
    text: [
      `Eingetragen: **${formatDate(startsOn)} – ${formatDate(endsOn)}** (${length} ${length === 1 ? "Tag" : "Tage"}).`,
      departmentIds.length > 0
        ? `Bereich: ${departmentIds.map((id) => getDepartmentName(departments, id)).join(", ")}`
        : "Bereich: Allgemein",
      config.requireApproval ? "Status: wartet auf Freigabe durch die Leitung." : ""
    ].filter(Boolean).join("\n")
  };
}
