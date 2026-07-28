import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "playtime-test-"));
process.env.DATA_DIR = path.join(tempDir, "data");

const {
  closeOpenSessions,
  getPlaytimeForSteamId,
  getTopPlayers,
  getUniquePlayerCount,
  syncPlayerSessions
} = await import("../src/modules/monitoring/services/playtime.js");

const SERVER = "srv_test_playtime";
const STEAM_A = "76561198000000001";
const STEAM_B = "76561198000000002";

// Feste Basiszeit, damit die Reihenfolge der Messungen deterministisch bleibt.
const T0 = Date.now();
const MINUTE = 60 * 1000;

test("syncPlayerSessions startet Sessions für neue Spieler", () => {
  const result = syncPlayerSessions(SERVER, [
    { steamId: STEAM_A, name: "Alice", durationSeconds: 0 },
    { steamId: STEAM_B, name: "Bob", durationSeconds: 0 }
  ], T0);

  assert.equal(result.tracked, 2);
  assert.equal(result.closed, 0);
  assert.equal(getUniquePlayerCount(SERVER), 2);
});

test("bekannte Spieler verlängern ihre Session statt eine neue zu starten", () => {
  // Innerhalb der Karenzzeit: Bob bleibt offen, obwohl er nicht gemeldet wird.
  const result = syncPlayerSessions(SERVER, [{ steamId: STEAM_A, name: "Alice" }], T0 + 3 * MINUTE);

  assert.equal(result.closed, 0);
  const stats = getPlaytimeForSteamId(STEAM_A);
  assert.equal(stats.sessions, 1);
  assert.equal(stats.seconds, 180);
});

test("verschwundene Spieler werden nach der Karenzzeit beendet", () => {
  const result = syncPlayerSessions(SERVER, [{ steamId: STEAM_A, name: "Alice" }], T0 + 60 * MINUTE);

  assert.equal(result.closed, 1); // Bob ist weg
  const bob = getPlaytimeForSteamId(STEAM_B);
  assert.equal(bob.sessions, 1);
  assert.equal(bob.seconds, 0); // Bob war nur zum Zeitpunkt T0 online
});

test("gemeldete Vorlaufzeit datiert den Sessionstart zurück", () => {
  const server = "srv_test_backdate";
  const now = Date.now();

  syncPlayerSessions(server, [{ steamId: "76561198000000003", name: "Carol", durationSeconds: 1800 }], now);
  closeOpenSessions(server, now);

  const stats = getPlaytimeForSteamId("76561198000000003");
  assert.ok(stats.seconds >= 1795, `erwartet ~1800s, war ${stats.seconds}`);
});

test("Spieler ohne SteamID werden über den Namen verfolgt", () => {
  const server = "srv_test_names";

  syncPlayerSessions(server, [{ name: "NurName" }], T0);
  syncPlayerSessions(server, [{ name: "NurName" }], T0 + 4 * MINUTE);

  assert.equal(getUniquePlayerCount(server), 1);
  // Ohne SteamID taucht der Spieler nicht in der Steam-Rangliste auf.
  assert.equal(getTopPlayers(server).length, 0);
});

test("getTopPlayers sortiert nach Spielzeit", () => {
  const players = getTopPlayers(SERVER, { limit: 10 });
  assert.ok(players.length >= 2);
  assert.ok(players[0].seconds >= players[1].seconds);
});

test("closeOpenSessions beendet alle laufenden Sessions", () => {
  const closed = closeOpenSessions(SERVER, T0 + 120 * MINUTE);
  assert.ok(closed >= 1);
  assert.equal(closeOpenSessions(SERVER), 0);
});
