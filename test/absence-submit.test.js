import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "absence-submit-"));
process.env.DATA_DIR = path.join(tempDir, "data");

const { submitAbsence } = await import("../src/modules/absence/services/submit.js");
const { listUserAbsences } = await import("../src/modules/absence/services/store.js");

const GUILD = "222222222222222222";
const USER = "333333333333333333";

// Der Bot wird nur für Einstellungen und Ankündigungen gebraucht. Ohne Guild
// im Cache bricht announceAbsence still ab, das genügt für die Prüfungen.
function makeClient(absenceConfig = {}, departments = []) {
  const state = {
    absence: { enabled: true, config: { maxDays: 90, allowSelfService: true, ...absenceConfig } },
    support: { enabled: true, config: { departments } }
  };

  return {
    guilds: { cache: new Map() },
    botContext: {
      logger: { warn() {}, info() {}, error() {} },
      settingsStore: {
        getModuleState: (_guildId, moduleName) => state[moduleName] || null,
        setModuleConfig() {}
      }
    }
  };
}

const member = { user: { username: "tester" }, roles: { cache: new Map() } };

test("deutsche Datumsangaben werden übernommen", async () => {
  const result = await submitAbsence({
    client: makeClient(), guildId: GUILD, member, userId: USER,
    von: "24.12.2026", bis: "02.01.2027", kind: "urlaub"
  });

  assert.equal(result.ok, true, result.text);
  assert.equal(result.absence.startsOn, "2026-12-24");
  assert.equal(result.absence.endsOn, "2027-01-02");
  assert.match(result.text, /24\.12\.2026 – 02\.01\.2027/);
  assert.match(result.text, /10 Tage/);
});

test("fehlendes Enddatum bedeutet denselben Tag", async () => {
  const result = await submitAbsence({
    client: makeClient(), guildId: GUILD, member, userId: USER, von: "2026-07-01", bis: ""
  });

  assert.equal(result.ok, true, result.text);
  assert.equal(result.absence.endsOn, "2026-07-01");
  assert.match(result.text, /1 Tag\b/);
});

test("unlesbare Datumsangaben werden abgelehnt", async () => {
  const result = await submitAbsence({
    client: makeClient(), guildId: GUILD, member, userId: USER, von: "nächste Woche"
  });

  assert.equal(result.ok, false);
  assert.match(result.text, /Datum konnte nicht gelesen werden/);
});

test("ein Ende vor dem Beginn wird abgelehnt", async () => {
  const result = await submitAbsence({
    client: makeClient(), guildId: GUILD, member, userId: USER,
    von: "10.05.2026", bis: "01.05.2026"
  });

  assert.equal(result.ok, false);
  assert.match(result.text, /Enddatum liegt vor dem Startdatum/);
});

test("die Höchstdauer wird durchgesetzt", async () => {
  const result = await submitAbsence({
    client: makeClient({ maxDays: 14 }), guildId: GUILD, member, userId: USER,
    von: "01.06.2026", bis: "30.06.2026"
  });

  assert.equal(result.ok, false);
  assert.match(result.text, /max\. 14 Tage/);
});

test("bei Freigabepflicht wartet der Eintrag", async () => {
  const result = await submitAbsence({
    client: makeClient({ requireApproval: true }), guildId: GUILD, member, userId: USER,
    von: "01.03.2027", bis: "05.03.2027"
  });

  assert.equal(result.ok, true, result.text);
  assert.equal(result.absence.status, "pending");
  assert.match(result.text, /wartet auf Freigabe/);
});

test("der Bereich kommt aus den Rollen, wenn keiner gewählt wurde", async () => {
  const departments = [
    { id: "support", name: "Support", roleIds: ["r-sup"], leadRoleIds: [] },
    { id: "technik", name: "Technik", roleIds: ["r-tec"], leadRoleIds: [] }
  ];

  const withRole = { user: { username: "tester" }, roles: { cache: new Map([["r-sup", {}]]) } };

  const result = await submitAbsence({
    client: makeClient({}, departments), guildId: GUILD, member: withRole, userId: USER,
    von: "01.04.2027"
  });

  assert.deepEqual(result.absence.departmentIds, ["support"]);
  assert.match(result.text, /Bereich: Support/);
});

test("ein ausdrücklich gewählter Bereich hat Vorrang", async () => {
  const departments = [
    { id: "support", name: "Support", roleIds: ["r-sup"], leadRoleIds: [] },
    { id: "technik", name: "Technik", roleIds: ["r-tec"], leadRoleIds: [] }
  ];

  const withRole = { user: { username: "tester" }, roles: { cache: new Map([["r-sup", {}]]) } };

  const result = await submitAbsence({
    client: makeClient({}, departments), guildId: GUILD, member: withRole, userId: USER,
    von: "01.05.2027", departmentId: "technik"
  });

  assert.deepEqual(result.absence.departmentIds, ["technik"]);
});

test("angelegte Einträge tauchen in der eigenen Liste auf", () => {
  const eigene = listUserAbsences(GUILD, USER, "2026-01-01");
  assert.ok(eigene.length >= 3, `nur ${eigene.length} Einträge`);
});
