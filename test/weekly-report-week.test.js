import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formatWeekLabel,
  getIsoWeekKey,
  getMondayOfWeekKey,
  getPreviousWeekKey,
  getPublishMoment,
  getTargetWeekKey,
  parseWeekKey
} from "../src/modules/weeklyReport/services/week.js";
import { parseTimeInput, parseWeekdayInput } from "../src/modules/weeklyReport/services/config.js";

test("getIsoWeekKey computes ISO week numbers including year boundaries", () => {
  assert.equal(getIsoWeekKey(new Date(2026, 0, 1)), "2026-W01");
  assert.equal(getIsoWeekKey(new Date(2025, 11, 29)), "2026-W01");
  assert.equal(getIsoWeekKey(new Date(2027, 0, 1)), "2026-W53");
  assert.equal(getIsoWeekKey(new Date(2026, 6, 3)), "2026-W27");
});

test("getMondayOfWeekKey returns the Monday of the given ISO week", () => {
  const monday = getMondayOfWeekKey("2026-W27");
  assert.equal(monday.getFullYear(), 2026);
  assert.equal(monday.getMonth(), 5);
  assert.equal(monday.getDate(), 29);
});

test("parseWeekKey parses valid keys and rejects malformed ones", () => {
  assert.deepEqual(parseWeekKey("2026-W27"), { year: 2026, week: 27 });
  assert.equal(parseWeekKey("27/2026"), null);
  assert.equal(parseWeekKey(""), null);
});

test("getPublishMoment resolves weekday and time within the current ISO week", () => {
  const wednesday = new Date(2026, 6, 1, 12, 0);
  const moment = getPublishMoment(wednesday, { publishWeekday: 7, publishHour: 18, publishMinute: 30 });

  assert.equal(moment.getDay(), 0);
  assert.equal(moment.getDate(), 5);
  assert.equal(moment.getHours(), 18);
  assert.equal(moment.getMinutes(), 30);
});

test("getTargetWeekKey switches to the next week after the publish moment", () => {
  const config = { publishWeekday: 7, publishHour: 18, publishMinute: 0 };

  const beforePublish = new Date(2026, 6, 3, 10, 0);
  assert.equal(getTargetWeekKey(beforePublish, config), "2026-W27");

  const afterPublish = new Date(2026, 6, 5, 19, 0);
  assert.equal(getTargetWeekKey(afterPublish, config), "2026-W28");
});

test("getPreviousWeekKey returns the preceding ISO week", () => {
  assert.equal(getPreviousWeekKey(new Date(2026, 6, 3)), "2026-W26");
  assert.equal(getPreviousWeekKey(new Date(2026, 0, 1)), "2025-W52");
});

test("formatWeekLabel renders a readable label", () => {
  assert.equal(formatWeekLabel("2026-W07"), "KW 7 / 2026");
});

test("parseWeekdayInput accepts numbers and German day names", () => {
  assert.equal(parseWeekdayInput("3"), 3);
  assert.equal(parseWeekdayInput("Sonntag"), 7);
  assert.equal(parseWeekdayInput("mo"), 1);
  assert.equal(parseWeekdayInput("8"), null);
  assert.equal(parseWeekdayInput("xyz"), null);
});

test("parseTimeInput accepts HH:MM and bare hours", () => {
  assert.deepEqual(parseTimeInput("18:30"), { hour: 18, minute: 30 });
  assert.deepEqual(parseTimeInput("7"), { hour: 7, minute: 0 });
  assert.equal(parseTimeInput("25:00"), null);
  assert.equal(parseTimeInput("18:65"), null);
  assert.equal(parseTimeInput("abends"), null);
});
