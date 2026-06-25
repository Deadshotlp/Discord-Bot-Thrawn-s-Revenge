import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "support-cases-test-"));
process.chdir(tempDir);

const {
  addSupportCaseAction,
  claimSupportCase,
  closeSupportCase,
  createSupportCase,
  escalateSupportCase,
  getSupportCase
} = await import("../src/modules/support/services/cases.js");

function openCase(guildId, userId) {
  return createSupportCase({
    guildId,
    userId,
    departmentId: "default",
    waitingChannelId: "waiting1",
    managementChannelId: "management1"
  });
}

test("createSupportCase opens a new case for a user", () => {
  const { caseData, created } = openCase("g1", "u1");
  assert.equal(created, true);
  assert.equal(caseData.status, "open");
  assert.equal(caseData.userId, "u1");
});

test("createSupportCase does not duplicate an active case for the same user", () => {
  const first = openCase("g2", "u2");
  const second = openCase("g2", "u2");
  assert.equal(second.created, false);
  assert.equal(second.caseData.id, first.caseData.id);
});

test("claimSupportCase transitions an open case to claimed", () => {
  const { caseData } = openCase("g3", "u3");
  const claimed = claimSupportCase("g3", caseData.id, "supporter1", "talk1");
  assert.equal(claimed.status, "claimed");
  assert.equal(claimed.supporterId, "supporter1");
  assert.equal(claimed.talkChannelId, "talk1");
});

test("claimSupportCase refuses to claim an already-closed case", () => {
  const { caseData } = openCase("g4", "u4");
  closeSupportCase("g4", caseData.id, "system");
  const claimed = claimSupportCase("g4", caseData.id, "supporter1", "talk1");
  assert.equal(claimed, null);
});

test("escalateSupportCase updates the department on an active case", () => {
  const { caseData } = openCase("g5", "u5");
  const escalated = escalateSupportCase("g5", caseData.id, "billing", "mod1");
  assert.equal(escalated.departmentId, "billing");
});

test("closeSupportCase marks the case closed and records who closed it", () => {
  const { caseData } = openCase("g6", "u6");
  const closed = closeSupportCase("g6", caseData.id, "mod1");
  assert.equal(closed.status, "closed");
  assert.ok(closed.closedAt > 0);
  assert.equal(getSupportCase("g6", caseData.id).status, "closed");
});

test("addSupportCaseAction appends an entry to the action log", () => {
  const { caseData } = openCase("g7", "u7");
  const updated = addSupportCaseAction("g7", caseData.id, "Test-Aktion");
  assert.ok(updated.actions.some((action) => action.text === "Test-Aktion"));
});
