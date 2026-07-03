import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildAgendaLines,
  buildAnnouncementPayload,
  buildEvaluationPayload
} from "../src/modules/meeting/services/agenda.js";

const meeting = {
  id: "team",
  name: "Team-Meeting",
  voiceChannelId: "999",
  intervalWeeks: 1,
  weekday: 3,
  hour: 20,
  minute: 0,
  participantRoleIds: ["111111111111111111"]
};

test("buildAgendaLines numbers topics and marks standing ones", () => {
  const lines = buildAgendaLines([
    { title: "Roadmap", standing: false },
    { title: "Feedback", standing: true }
  ]);

  assert.match(lines, /\*\*1\.\*\* Roadmap/);
  assert.match(lines, /\*\*2\.\*\* Feedback 🔁/);
});

test("buildAgendaLines shows placeholder when empty", () => {
  assert.match(buildAgendaLines([]), /Noch keine Themen/);
});

test("buildAnnouncementPayload pings participant roles and lists sign-ups", () => {
  const payload = buildAnnouncementPayload({
    meeting,
    occurrence: new Date(2026, 6, 1, 20, 0),
    topics: [{ title: "Roadmap", standing: false }],
    registeredIds: ["a", "b"],
    declinedIds: ["c"]
  });

  assert.equal(payload.content, "<@&111111111111111111>");
  assert.deepEqual(payload.allowedMentions.roles, ["111111111111111111"]);

  const embed = payload.embeds[0].toJSON();
  const registeredField = embed.fields.find((field) => field.name.startsWith("✅"));
  assert.match(registeredField.name, /\(2\)/);
  assert.match(registeredField.value, /<@a>/);

  // Genau ein Button-Row mit drei Buttons.
  assert.equal(payload.components.length, 1);
  assert.equal(payload.components[0].toJSON().components.length, 3);
});

test("buildEvaluationPayload lists the three attendance categories and suppresses pings", () => {
  const payload = buildEvaluationPayload({
    meeting,
    occurrence: new Date(2026, 6, 1, 20, 0),
    presentIds: ["a"],
    excusedIds: ["c"],
    absentIds: ["b"]
  });

  const embed = payload.embeds[0].toJSON();
  assert.match(embed.fields[0].name, /Anwesend \(1\)/);
  assert.match(embed.fields[1].name, /Entschuldigt \(1\)/);
  assert.match(embed.fields[2].name, /Unentschuldigt \(1\)/);
  assert.deepEqual(payload.allowedMentions.parse, []);
});
