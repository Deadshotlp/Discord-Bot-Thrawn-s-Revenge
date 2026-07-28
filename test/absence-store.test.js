import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "absence-test-"));
process.env.DATA_DIR = path.join(tempDir, "data");

const {
  ABSENCE_STATUS,
  createAbsence,
  daysBetween,
  deleteAbsence,
  groupByDepartment,
  isValidDate,
  listAbsencesInRange,
  listCurrentAbsences,
  listUserAbsences,
  setAbsenceStatus,
  toIsoDate,
  updateAbsence
} = await import("../src/modules/absence/services/store.js");

const GUILD = "100000000000000001";
const USER = "200000000000000002";

test("toIsoDate versteht deutsche und ISO-Schreibweisen", () => {
  assert.equal(toIsoDate("2026-12-24"), "2026-12-24");
  assert.equal(toIsoDate("24.12.2026"), "2026-12-24");
  assert.equal(toIsoDate("4.7.2026"), "2026-07-04");
  assert.equal(toIsoDate("24.12.26"), "2026-12-24");
  assert.equal(toIsoDate("Unsinn"), "");
});

test("isValidDate erkennt unmögliche Daten", () => {
  assert.equal(isValidDate("2026-02-28"), true);
  assert.equal(isValidDate("2026-02-30"), false);
  assert.equal(isValidDate("2026-13-01"), false);
});

test("daysBetween zählt beide Randtage mit", () => {
  assert.equal(daysBetween("2026-07-01", "2026-07-01"), 1);
  assert.equal(daysBetween("2026-07-01", "2026-07-07"), 7);
});

test("createAbsence legt einen Eintrag mit Departments an", () => {
  const absence = createAbsence({
    guildId: GUILD,
    userId: USER,
    departmentIds: ["support", "event"],
    startsOn: "01.08.2026",
    endsOn: "07.08.2026",
    kind: "urlaub",
    reason: "Sommerurlaub"
  });

  assert.equal(absence.startsOn, "2026-08-01");
  assert.equal(absence.endsOn, "2026-08-07");
  assert.equal(absence.days, 7);
  assert.equal(absence.kind, "urlaub");
  assert.deepEqual(absence.departmentIds, ["support", "event"]);
  assert.equal(absence.status, ABSENCE_STATUS.active);
});

test("createAbsence weist ein Enddatum vor dem Startdatum zurück", () => {
  assert.throws(() => createAbsence({
    guildId: GUILD,
    userId: USER,
    startsOn: "2026-08-10",
    endsOn: "2026-08-01"
  }), /Enddatum/);
});

test("createAbsence weist ungültige Daten zurück", () => {
  assert.throws(() => createAbsence({
    guildId: GUILD,
    userId: USER,
    startsOn: "kein-datum",
    endsOn: "auch-nicht"
  }), /Datum/);
});

test("listAbsencesInRange findet überlappende Zeiträume", () => {
  const guildId = "100000000000000010";
  createAbsence({
    guildId,
    userId: USER,
    startsOn: "2026-09-10",
    endsOn: "2026-09-20"
  });

  assert.equal(listAbsencesInRange(guildId, "2026-09-15", "2026-09-16").length, 1);
  assert.equal(listAbsencesInRange(guildId, "2026-09-01", "2026-09-10").length, 1);
  assert.equal(listAbsencesInRange(guildId, "2026-09-20", "2026-09-30").length, 1);
  assert.equal(listAbsencesInRange(guildId, "2026-09-21", "2026-09-30").length, 0);
});

test("listCurrentAbsences berücksichtigt nur aktive Einträge", () => {
  const guildId = "100000000000000011";
  const today = toIsoDate(new Date());

  const active = createAbsence({ guildId, userId: USER, startsOn: today, endsOn: today });
  createAbsence({
    guildId,
    userId: "200000000000000003",
    startsOn: today,
    endsOn: today,
    status: ABSENCE_STATUS.pending
  });

  assert.equal(listCurrentAbsences(guildId).length, 1);

  setAbsenceStatus(active.id, ABSENCE_STATUS.cancelled);
  assert.equal(listCurrentAbsences(guildId).length, 0);
});

test("updateAbsence ändert Zeitraum und Art", () => {
  const guildId = "100000000000000012";
  const absence = createAbsence({ guildId, userId: USER, startsOn: "2026-10-01", endsOn: "2026-10-02" });

  const updated = updateAbsence(absence.id, { endsOn: "10.10.2026", kind: "krank" });
  assert.equal(updated.endsOn, "2026-10-10");
  assert.equal(updated.kind, "krank");
  assert.equal(updated.days, 10);
});

test("listUserAbsences liefert nur offene Einträge des Nutzers", () => {
  const guildId = "100000000000000013";
  const future = toIsoDate(new Date(Date.now() + 5 * 86400000));

  createAbsence({ guildId, userId: USER, startsOn: future, endsOn: future });
  createAbsence({ guildId, userId: "200000000000000009", startsOn: future, endsOn: future });

  assert.equal(listUserAbsences(guildId, USER).length, 1);
});

test("groupByDepartment ordnet Einträge ohne Department unter dem Leerschlüssel ein", () => {
  const grouped = groupByDepartment([
    { userId: "a", departmentIds: ["support"] },
    { userId: "b", departmentIds: [] },
    { userId: "c", departmentIds: ["support", "event"] }
  ]);

  assert.equal(grouped.get("support").length, 2);
  assert.equal(grouped.get("event").length, 1);
  assert.equal(grouped.get("").length, 1);
});

test("deleteAbsence entfernt den Eintrag", () => {
  const guildId = "100000000000000014";
  const absence = createAbsence({ guildId, userId: USER, startsOn: "2026-11-01", endsOn: "2026-11-01" });

  assert.equal(deleteAbsence(absence.id), true);
  assert.equal(deleteAbsence(absence.id), false);
});
