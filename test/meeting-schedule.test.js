import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formatSchedule,
  getMostRecentOccurrence,
  getNextOccurrence,
  getOccurrenceKey,
  parseTimeInput,
  parseWeekdayInput
} from "../src/modules/meeting/services/schedule.js";

// Basis: Meeting mittwochs 20:00, Anker in einer Mittwochs-Woche.
const weekly = {
  anchorDate: "2026-07-01", // Mittwoch
  intervalWeeks: 1,
  weekday: 3,
  hour: 20,
  minute: 0
};

test("getNextOccurrence returns the upcoming weekly occurrence", () => {
  const now = new Date(2026, 6, 1, 18, 0); // Mi 18:00, vor dem Termin
  const next = getNextOccurrence(now, weekly);
  assert.equal(getOccurrenceKey(next), "2026-07-01");
  assert.equal(next.getHours(), 20);
});

test("getNextOccurrence rolls over to next week after the occurrence", () => {
  const now = new Date(2026, 6, 1, 21, 0); // Mi 21:00, nach dem Termin
  const next = getNextOccurrence(now, weekly);
  assert.equal(getOccurrenceKey(next), "2026-07-08");
});

test("getMostRecentOccurrence returns the occurrence that just started", () => {
  const now = new Date(2026, 6, 1, 20, 4); // 4 Min nach Beginn
  const recent = getMostRecentOccurrence(now, weekly);
  assert.equal(getOccurrenceKey(recent), "2026-07-01");
});

test("biweekly interval skips the off week", () => {
  const biweekly = { ...weekly, intervalWeeks: 2 };

  // Anker-Woche 2026-07-01. Zwei Wochen später (2026-07-15) ist wieder ein Termin,
  // die Woche dazwischen (2026-07-08) nicht.
  const inOnWeek = getNextOccurrence(new Date(2026, 6, 15, 10, 0), biweekly);
  assert.equal(getOccurrenceKey(inOnWeek), "2026-07-15");

  // In der Off-Woche (2026-07-08) ist der nächste Termin erst 2026-07-15.
  const inOffWeek = getNextOccurrence(new Date(2026, 6, 8, 10, 0), biweekly);
  assert.equal(getOccurrenceKey(inOffWeek), "2026-07-15");
});

test("parseWeekdayInput and parseTimeInput accept numbers and names", () => {
  assert.equal(parseWeekdayInput("Mittwoch"), 3);
  assert.equal(parseWeekdayInput("3"), 3);
  assert.equal(parseWeekdayInput("foo"), null);
  assert.deepEqual(parseTimeInput("20:30"), { hour: 20, minute: 30 });
  assert.deepEqual(parseTimeInput("9"), { hour: 9, minute: 0 });
  assert.equal(parseTimeInput("24:00"), null);
});

test("formatSchedule describes weekday, time and rhythm", () => {
  assert.equal(formatSchedule(weekly), "Mittwoch, 20:00 Uhr (wöchentlich)");
  assert.equal(formatSchedule({ ...weekly, intervalWeeks: 2 }), "Mittwoch, 20:00 Uhr (alle 2 Wochen)");
});
