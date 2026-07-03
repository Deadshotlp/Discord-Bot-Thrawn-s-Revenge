import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateAttendance } from "../src/modules/meeting/services/evaluation.js";
import {
  isMeetingOrganizer,
  isMeetingParticipant,
  normalizeMeeting
} from "../src/modules/meeting/services/config.js";

function sorted(list) {
  return [...list].sort();
}

test("evaluateAttendance categorizes present, excused and absent", () => {
  const registrations = [
    { userId: "a", state: "registered" },
    { userId: "b", state: "registered" },
    { userId: "c", state: "declined" },
    { userId: "d", state: "declined" }
  ];
  // a und e sind im Voice (e hat sich nicht angemeldet, zählt trotzdem als anwesend);
  // d ist abgemeldet, aber trotzdem erschienen -> anwesend, nicht entschuldigt.
  const voiceUserIds = ["a", "d", "e"];

  const result = evaluateAttendance(registrations, voiceUserIds);

  assert.deepEqual(sorted(result.presentIds), ["a", "d", "e"]);
  assert.deepEqual(sorted(result.excusedIds), ["c"]); // abgemeldet und nicht da
  assert.deepEqual(sorted(result.absentIds), ["b"]);  // angemeldet, aber nicht da
});

test("evaluateAttendance with nobody present marks registered as absent, declined as excused", () => {
  const registrations = [
    { userId: "a", state: "registered" },
    { userId: "b", state: "declined" }
  ];

  const result = evaluateAttendance(registrations, []);
  assert.deepEqual(result.presentIds, []);
  assert.deepEqual(result.excusedIds, ["b"]);
  assert.deepEqual(result.absentIds, ["a"]);
});

test("normalizeMeeting fills defaults and keeps role lists", () => {
  const meeting = normalizeMeeting({
    name: "Team",
    announceChannelId: "123",
    participantRoleIds: ["1".repeat(18), "1".repeat(18)],
    organizerRoleIds: ["2".repeat(18)],
    weekday: 3,
    hour: 20
  });

  assert.equal(meeting.id, "team");
  assert.equal(meeting.intervalWeeks, 1);
  assert.equal(meeting.minute, 0);
  assert.deepEqual(meeting.participantRoleIds, ["1".repeat(18)]);
  assert.deepEqual(meeting.organizerRoleIds, ["2".repeat(18)]);
});

test("normalizeMeeting rejects entries without a name", () => {
  assert.equal(normalizeMeeting({ announceChannelId: "1" }), null);
});

function member(roleIds) {
  return { roles: { cache: new Map(roleIds.map((id) => [id, { id }])) } };
}

test("isMeetingParticipant allows everyone when no roles configured", () => {
  assert.equal(isMeetingParticipant(member([]), { participantRoleIds: [] }), true);
  assert.equal(isMeetingParticipant(member(["x"]), { participantRoleIds: ["y"] }), false);
  assert.equal(isMeetingParticipant(member(["y"]), { participantRoleIds: ["y"] }), true);
});

test("isMeetingOrganizer requires a matching organizer role", () => {
  assert.equal(isMeetingOrganizer(member(["o"]), { organizerRoleIds: ["o"] }), true);
  assert.equal(isMeetingOrganizer(member(["x"]), { organizerRoleIds: ["o"] }), false);
  assert.equal(isMeetingOrganizer(member(["o"]), { organizerRoleIds: [] }), false);
});
