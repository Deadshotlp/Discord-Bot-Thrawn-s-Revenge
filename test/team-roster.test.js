import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "roster-test-"));
process.env.DATA_DIR = path.join(tempDir, "data");

const { buildRoster } = await import("../src/modules/teamList/services/roster.js");
const { formatMemberLine, joinLines } = await import("../src/modules/teamList/services/render.js");

const TODAY = "2026-08-22";

const DEPARTMENTS = [
  { id: "support", name: "Support", roleIds: ["r-support"], leadRoleIds: ["r-support-lead"] },
  { id: "technik", name: "Technik", roleIds: ["r-technik"], leadRoleIds: ["r-technik-lead"] },
  { id: "leer", name: "Ohne Rollen", roleIds: [], leadRoleIds: [] }
];

const MEMBERS = [
  { id: "1", displayName: "Anna", username: "anna", avatarUrl: "", bot: false, roleIds: ["r-support"] },
  { id: "2", displayName: "Bernd", username: "bernd", avatarUrl: "", bot: false, roleIds: ["r-support", "r-support-lead"] },
  { id: "3", displayName: "Clara", username: "clara", avatarUrl: "", bot: false, roleIds: ["r-technik-lead"] },
  { id: "4", displayName: "Dirk", username: "dirk", avatarUrl: "", bot: false, roleIds: ["r-support", "r-technik"] },
  { id: "5", displayName: "Emil", username: "emil", avatarUrl: "", bot: false, roleIds: ["r-gast"] },
  { id: "6", displayName: "BotAccount", username: "bot", avatarUrl: "", bot: true, roleIds: ["r-support"] }
];

function absence(userId, startsOn, endsOn, overrides = {}) {
  return {
    id: `abs-${userId}-${startsOn}`,
    userId,
    startsOn,
    endsOn,
    kind: "urlaub",
    status: "active",
    reason: "",
    departmentIds: [],
    ...overrides
  };
}

function groupOf(roster, id) {
  return roster.departments.find((group) => group.id === id);
}

function memberOf(roster, departmentId, name) {
  return groupOf(roster, departmentId).members.find((entry) => entry.name === name);
}

test("Mitglieder werden ihren Departments über die Rollen zugeordnet", () => {
  const roster = buildRoster({ members: MEMBERS, departments: DEPARTMENTS, today: TODAY });

  assert.deepEqual(
    groupOf(roster, "support").members.map((entry) => entry.name),
    ["Bernd", "Anna", "Dirk"]
  );
  assert.deepEqual(groupOf(roster, "technik").members.map((entry) => entry.name), ["Clara", "Dirk"]);
});

test("wer nur die Leitungsrolle trägt, gehört trotzdem zum Bereich", () => {
  const roster = buildRoster({ members: MEMBERS, departments: DEPARTMENTS, today: TODAY });
  const clara = memberOf(roster, "technik", "Clara");

  assert.ok(clara, "Clara fehlt in der Technik");
  assert.equal(clara.isLead, true);
});

test("Leitung steht oben, der Rest alphabetisch", () => {
  const roster = buildRoster({ members: MEMBERS, departments: DEPARTMENTS, today: TODAY });
  const support = groupOf(roster, "support").members;

  assert.equal(support[0].name, "Bernd");
  assert.equal(support[0].isLead, true);
  assert.deepEqual(support.slice(1).map((entry) => entry.name), ["Anna", "Dirk"]);
});

test("Bots und Mitglieder ohne Department bleiben außen vor", () => {
  const roster = buildRoster({ members: MEMBERS, departments: DEPARTMENTS, today: TODAY });
  const alle = roster.departments.flatMap((group) => group.members.map((entry) => entry.name));

  assert.ok(!alle.includes("BotAccount"));
  assert.ok(!alle.includes("Emil"));
});

test("nur heute laufende Abmeldungen werden vermerkt", () => {
  const roster = buildRoster({
    members: MEMBERS,
    departments: DEPARTMENTS,
    today: TODAY,
    absences: [
      absence("1", "2026-08-20", "2026-08-25"),
      absence("2", "2026-09-01", "2026-09-10"),
      absence("4", "2026-08-01", "2026-08-10")
    ]
  });

  assert.equal(memberOf(roster, "support", "Anna").absence.label, "Urlaub");
  assert.equal(memberOf(roster, "support", "Bernd").absence, null, "künftige Abmeldung darf nicht zählen");
  assert.equal(memberOf(roster, "support", "Dirk").absence, null, "vergangene Abmeldung darf nicht zählen");
});

test("nicht freigegebene Abmeldungen zählen nicht als abwesend", () => {
  const roster = buildRoster({
    members: MEMBERS,
    departments: DEPARTMENTS,
    today: TODAY,
    absences: [absence("1", "2026-08-20", "2026-08-25", { status: "pending" })]
  });

  assert.equal(memberOf(roster, "support", "Anna").absence, null);
  assert.equal(roster.totals.absent, 0);
});

test("bei mehreren laufenden Abmeldungen gilt die längere", () => {
  const roster = buildRoster({
    members: MEMBERS,
    departments: DEPARTMENTS,
    today: TODAY,
    absences: [
      absence("1", "2026-08-20", "2026-08-23"),
      absence("1", "2026-08-21", "2026-08-30", { kind: "krank" })
    ]
  });

  assert.equal(memberOf(roster, "support", "Anna").absence.endsOn, "2026-08-30");
  assert.equal(memberOf(roster, "support", "Anna").absence.label, "Krank");
});

test("Kennzahlen zählen Personen, nicht Einträge", () => {
  const roster = buildRoster({
    members: MEMBERS,
    departments: DEPARTMENTS,
    today: TODAY,
    absences: [absence("4", "2026-08-20", "2026-08-25")]
  });

  // Anna, Bernd, Clara, Dirk – Dirk ist in zwei Bereichen und zählt einmal.
  assert.equal(roster.totals.members, 4);
  assert.equal(roster.totals.leads, 2);
  assert.equal(roster.totals.absent, 1);
});

test("Departments ohne Rollen werden als unkonfiguriert markiert", () => {
  const roster = buildRoster({ members: MEMBERS, departments: DEPARTMENTS, today: TODAY });
  const leer = groupOf(roster, "leer");

  assert.equal(leer.unconfigured, true);
  assert.deepEqual(leer.members, []);
});

test("die Zeile zeigt Leitung und Abmeldung an", () => {
  const line = formatMemberLine({
    id: "42",
    name: "Bernd",
    isLead: true,
    absence: { emoji: "🌴", label: "Urlaub", endsOn: "2026-08-25" }
  });

  assert.match(line, /<@42>/);
  assert.match(line, /Leitung/);
  assert.match(line, /Urlaub bis 25\.08\.2026/);
});

test("zu lange Felder werden mit Hinweis gekürzt statt abgewiesen", () => {
  const lines = Array.from({ length: 200 }, (_, index) => `• <@${index}> Mitglied Nummer ${index}`);
  const value = joinLines(lines, 1024);

  assert.ok(value.length <= 1024, `${value.length} Zeichen`);
  assert.match(value, /… und \d+ weitere$/);
});

// --- Embed-Aufbau und -Grenzen ---------------------------------------------

const { allocateBudgets, buildRosterEmbeds } = await import("../src/modules/teamList/services/render.js");

// So zählt Discord: Titel, Beschreibung, Feldnamen, Feldwerte und Fußzeile
// aller Embeds einer Nachricht zusammen.
function messageLength(embeds) {
  return embeds.reduce((sum, embed) => {
    const json = embed.toJSON();

    return sum
      + (json.title || "").length
      + (json.description || "").length
      + (json.footer?.text || "").length
      + (json.fields || []).reduce((inner, entry) => inner + entry.name.length + entry.value.length, 0);
  }, 0);
}

function embedFor(embeds, departmentName) {
  return embeds.find((embed) => embed.toJSON().title === departmentName)?.toJSON();
}

function bigRoster(departmentCount, perDepartment) {
  const departments = Array.from({ length: departmentCount }, (_, index) => ({
    id: `d${index}`,
    name: `Department mit langem Namen ${index + 1}`,
    roleIds: [`r${index}`],
    leadRoleIds: [`l${index}`]
  }));

  const members = Array.from({ length: departmentCount * perDepartment }, (_, index) => ({
    id: String(100000000000000000n + BigInt(index)),
    displayName: `Mitglied ${index}`,
    username: `user${index}`,
    avatarUrl: "",
    bot: false,
    roleIds: [`r${index % departmentCount}`, ...(index % 20 === 0 ? [`l${index % departmentCount}`] : [])]
  }));

  const absences = members.slice(0, 50).map((member, index) => ({
    id: `a${index}`,
    userId: member.id,
    startsOn: "2026-08-01",
    endsOn: "2026-09-01",
    kind: "urlaub",
    status: "active",
    reason: "",
    departmentIds: []
  }));

  return buildRoster({ members, departments, absences, today: TODAY });
}

test("je Department ein eigenes Embed, dazu eine Kopfzeile", () => {
  const roster = buildRoster({ members: MEMBERS, departments: DEPARTMENTS, today: TODAY });
  const embeds = buildRosterEmbeds(roster, { guildName: "Testserver" });

  // Kopf + Support + Technik; "Ohne Rollen" ist unkonfiguriert und entfällt.
  assert.equal(embeds.length, 3);
  assert.equal(embeds[0].toJSON().title, "Teamliste · Testserver");
  assert.deepEqual(embeds.slice(1).map((embed) => embed.toJSON().title), ["Support", "Technik"]);
});

test("kleine Departments werden vollständig aufgelistet", () => {
  // Regression: ein Bereich, der wenig Platz braucht und genau so viel
  // zugeteilt bekommt, wurde fälschlich als "zu viele für die Anzeige"
  // zusammengefasst.
  const roster = buildRoster({ members: MEMBERS, departments: DEPARTMENTS, today: TODAY });
  const technik = embedFor(buildRosterEmbeds(roster, {}), "Technik");

  assert.ok(!technik.description.includes("Zu viele"), technik.description);
  assert.match(technik.description, /<@3>/);
  assert.match(technik.description, /<@4>/);
});

test("auch ein Department mit einer einzigen Person wird aufgelistet", () => {
  const departments = [{ id: "solo", name: "Entwicklung", roleIds: ["r-dev"], leadRoleIds: ["l-dev"] }];
  const members = [
    { id: "9", displayName: "Solo", username: "solo", avatarUrl: "", bot: false, roleIds: ["r-dev", "l-dev"] }
  ];

  const embed = embedFor(buildRosterEmbeds(buildRoster({ members, departments, today: TODAY }), {}), "Entwicklung");

  assert.match(embed.description, /<@9>/);
  assert.match(embed.description, /1 Mitglied ·/, "Einzahl statt \"1 Mitglieder\"");
  assert.ok(!embed.description.includes("Zu viele"));
});

test("die Nachricht bleibt in Discords Grenzen, auch bei großen Teams", () => {
  for (const [departmentCount, perDepartment] of [[3, 10], [8, 50], [25, 200], [40, 100]]) {
    const embeds = buildRosterEmbeds(bigRoster(departmentCount, perDepartment), { guildName: "Testserver" });
    const label = `${departmentCount}×${perDepartment}`;

    assert.ok(embeds.length <= 10, `${label}: ${embeds.length} Embeds`);
    assert.ok(messageLength(embeds) <= 6000, `${label}: ${messageLength(embeds)} Zeichen gesamt`);

    for (const embed of embeds) {
      const json = embed.toJSON();
      assert.ok((json.description || "").length <= 4096, `${label}: Beschreibung zu lang`);
      assert.ok((json.description || "").length > 0, `${label}: leeres Embed`);
    }
  }
});

test("das Budget wird fair verteilt, kleine Bereiche verhungern nicht", () => {
  const limits = allocateBudgets([50, 50, 4000], 1200);

  assert.deepEqual(limits.slice(0, 2), [50, 50], "kleine Bereiche bekommen, was sie brauchen");
  assert.ok(limits[2] >= 1000, `großer Bereich bekam nur ${limits[2]}`);
  assert.ok(limits.reduce((sum, value) => sum + value, 0) <= 1200);
});

test("ein einzelnes Department lässt sich gezielt anzeigen", () => {
  const roster = buildRoster({ members: MEMBERS, departments: DEPARTMENTS, today: TODAY });
  const embeds = buildRosterEmbeds(roster, { departmentId: "technik" });

  assert.equal(embeds.length, 2);
  assert.equal(embeds[1].toJSON().title, "Technik");
});

test("alle Embeds bekommen dieselbe Mindestbreite", () => {
  const roster = buildRoster({ members: MEMBERS, departments: DEPARTMENTS, today: TODAY });
  const embeds = buildRosterEmbeds(roster, { guildName: "Testserver" });

  // U+2800 wird von Discord nicht zusammengefaltet und setzt die Breite.
  const breiten = embeds.map((embed) => {
    const zeile = embed.toJSON().description.split("\n").find((line) => line.includes("\u2800"));
    return zeile ? zeile.length : 0;
  });

  assert.ok(breiten.every((breite) => breite > 0), "ein Embed ohne Breiten-Platzhalter");
  assert.equal(new Set(breiten).size, 1, `unterschiedliche Breiten: ${breiten.join(", ")}`);
});
