import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meeting-store-test-"));
process.env.DATA_DIR = path.join(tempDir, "data");

const {
  addMeetingTopic,
  consumeMeetingTopics,
  listMeetingTopics,
  moveMeetingTopic,
  setMeetingTopicStanding,
  removeMeetingTopic,
  setMeetingAttendance,
  listMeetingAttendance
} = await import("../src/modules/meeting/services/store.js");

test("topics are stored in submission order", () => {
  addMeetingTopic({ guildId: "g", meetingId: "m", authorId: "u1", title: "Erstes" });
  addMeetingTopic({ guildId: "g", meetingId: "m", authorId: "u2", title: "Zweites" });

  const topics = listMeetingTopics("g", "m");
  assert.deepEqual(topics.map((topic) => topic.title), ["Erstes", "Zweites"]);
});

test("moveMeetingTopic swaps order with the neighbour", () => {
  const [first, second] = listMeetingTopics("g", "m");
  assert.equal(moveMeetingTopic("g", "m", second.id, "up"), true);

  const reordered = listMeetingTopics("g", "m");
  assert.deepEqual(reordered.map((topic) => topic.title), ["Zweites", "Erstes"]);

  // Am Rand nicht verschiebbar.
  assert.equal(moveMeetingTopic("g", "m", reordered[0].id, "up"), false);
  assert.strictEqual(first.title, "Erstes");
});

test("standing topics survive consumeMeetingTopics, one-off topics do not", () => {
  const topics = listMeetingTopics("g", "m");
  setMeetingTopicStanding("g", "m", topics[0].id, true);

  consumeMeetingTopics("g", "m");

  const remaining = listMeetingTopics("g", "m");
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].standing, true);
});

test("removeMeetingTopic deletes a topic", () => {
  const added = addMeetingTopic({ guildId: "g2", meetingId: "m", authorId: "u", title: "Weg" });
  assert.equal(removeMeetingTopic("g2", "m", added.id), true);
  assert.equal(listMeetingTopics("g2", "m").length, 0);
});

test("attendance upserts by user and occurrence", () => {
  setMeetingAttendance({ guildId: "g3", meetingId: "m", occurrenceKey: "2026-07-01", userId: "u", state: "registered" });
  setMeetingAttendance({ guildId: "g3", meetingId: "m", occurrenceKey: "2026-07-01", userId: "u", state: "declined" });
  setMeetingAttendance({ guildId: "g3", meetingId: "m", occurrenceKey: "2026-07-01", userId: "v", state: "registered" });

  const list = listMeetingAttendance("g3", "m", "2026-07-01");
  assert.equal(list.length, 2);
  assert.equal(list.find((entry) => entry.user_id === "u").state, "declined");
});
