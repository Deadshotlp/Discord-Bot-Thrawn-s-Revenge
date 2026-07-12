import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weekly-report-store-test-"));
process.env.DATA_DIR = path.join(tempDir, "data");

const {
  deleteWeeklyReport,
  getWeeklyReport,
  hasUnpublishedReports,
  listWeeklyReportsForWeek,
  markWeekPublished,
  upsertWeeklyReport
} = await import("../src/modules/weeklyReport/services/reports.js");

test("upsertWeeklyReport stores a retrievable report", () => {
  upsertWeeklyReport({
    guildId: "g1",
    week: "2026-W27",
    departmentId: "technik",
    authorId: "user1",
    content: "Alles läuft."
  });

  const report = getWeeklyReport("g1", "2026-W27", "technik");
  assert.equal(report.content, "Alles läuft.");
  assert.equal(report.authorId, "user1");
  assert.equal(report.publishedAt, undefined);
});

test("upsertWeeklyReport overwrites an existing submission", () => {
  upsertWeeklyReport({ guildId: "g2", week: "2026-W27", departmentId: "d1", authorId: "a", content: "Erste Fassung" });
  upsertWeeklyReport({ guildId: "g2", week: "2026-W27", departmentId: "d1", authorId: "b", content: "Zweite Fassung" });

  const report = getWeeklyReport("g2", "2026-W27", "d1");
  assert.equal(report.content, "Zweite Fassung");
  assert.equal(report.authorId, "b");
  assert.equal(listWeeklyReportsForWeek("g2", "2026-W27").length, 1);
});

test("listWeeklyReportsForWeek only returns the requested week and guild", () => {
  upsertWeeklyReport({ guildId: "g3", week: "2026-W27", departmentId: "d1", authorId: "a", content: "x" });
  upsertWeeklyReport({ guildId: "g3", week: "2026-W28", departmentId: "d1", authorId: "a", content: "y" });
  upsertWeeklyReport({ guildId: "other", week: "2026-W27", departmentId: "d1", authorId: "a", content: "z" });

  const reports = listWeeklyReportsForWeek("g3", "2026-W27");
  assert.equal(reports.length, 1);
  assert.equal(reports[0].content, "x");
});

test("deleteWeeklyReport removes a submission", () => {
  upsertWeeklyReport({ guildId: "g4", week: "2026-W27", departmentId: "d1", authorId: "a", content: "x" });

  assert.equal(deleteWeeklyReport("g4", "2026-W27", "d1"), true);
  assert.equal(getWeeklyReport("g4", "2026-W27", "d1"), null);
  assert.equal(deleteWeeklyReport("g4", "2026-W27", "d1"), false);
});

test("markWeekPublished flags all reports of the week and hasUnpublishedReports reflects it", () => {
  upsertWeeklyReport({ guildId: "g5", week: "2026-W27", departmentId: "d1", authorId: "a", content: "x" });
  upsertWeeklyReport({ guildId: "g5", week: "2026-W27", departmentId: "d2", authorId: "b", content: "y" });

  assert.equal(hasUnpublishedReports("g5", "2026-W27"), true);
  assert.equal(markWeekPublished("g5", "2026-W27"), 2);
  assert.equal(hasUnpublishedReports("g5", "2026-W27"), false);

  const reports = listWeeklyReportsForWeek("g5", "2026-W27");
  assert.ok(reports.every((report) => Number.isInteger(report.publishedAt)));
});
