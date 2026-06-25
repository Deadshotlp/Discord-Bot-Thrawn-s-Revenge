import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "server-status-history-test-"));
process.chdir(tempDir);

const {
  buildDailyPlayerStats,
  getServerStatusSnapshotsSince,
  pruneServerStatusSnapshotsOlderThan,
  recordServerStatusSnapshot
} = await import("../src/modules/serverStatus/services/history.js");

test("recordServerStatusSnapshot stores a retrievable snapshot", () => {
  recordServerStatusSnapshot({
    guildId: "g1",
    online: true,
    playerCount: 10,
    maxPlayers: 32,
    map: "gm_construct"
  });

  const snapshots = getServerStatusSnapshotsSince("g1", 0);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].online, true);
  assert.equal(snapshots[0].playerCount, 10);
  assert.equal(snapshots[0].map, "gm_construct");
});

test("getServerStatusSnapshotsSince only returns snapshots after the given timestamp", () => {
  const cutoff = Date.now();
  recordServerStatusSnapshot({ guildId: "g2", online: true, playerCount: 1, maxPlayers: 10, map: "m1" });
  const snapshots = getServerStatusSnapshotsSince("g2", cutoff - 1000);
  assert.equal(snapshots.length, 1);
  assert.equal(getServerStatusSnapshotsSince("g2", cutoff + 60_000).length, 0);
});

test("pruneServerStatusSnapshotsOlderThan removes only old rows for that guild", () => {
  recordServerStatusSnapshot({ guildId: "g3", online: true, playerCount: 3, maxPlayers: 10, map: "m1" });
  const removed = pruneServerStatusSnapshotsOlderThan("g3", Date.now() + 60_000);
  assert.equal(removed, 1);
  assert.equal(getServerStatusSnapshotsSince("g3", 0).length, 0);
});

test("buildDailyPlayerStats aggregates peak and average per day bucket", () => {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const snapshots = [
    { takenAt: now - dayMs * 0.5, online: true, playerCount: 10, maxPlayers: 32, map: "m1" },
    { takenAt: now - dayMs * 0.5 - 60_000, online: true, playerCount: 20, maxPlayers: 32, map: "m1" },
    { takenAt: now - dayMs * 0.5 - 120_000, online: false, playerCount: 0, maxPlayers: 0, map: "" }
  ];

  const buckets = buildDailyPlayerStats(snapshots, 7, now);
  assert.equal(buckets.length, 7);

  const todayBucket = buckets.at(-1);
  assert.equal(todayBucket.peak, 20);
  assert.equal(todayBucket.average, 15);
});
