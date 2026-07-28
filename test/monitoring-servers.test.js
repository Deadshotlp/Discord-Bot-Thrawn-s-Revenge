import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "monitoring-test-"));
process.env.DATA_DIR = path.join(tempDir, "data");

const {
  createServer,
  deleteServer,
  getServer,
  listAllEnabledServers,
  listServers,
  normalizeHost,
  normalizeInterval,
  normalizePort,
  updateServer
} = await import("../src/modules/monitoring/services/servers.js");

const { getLatestSample, getSeries, getUptime, recordSample } =
  await import("../src/modules/monitoring/services/history.js");

const { buildServerSummary, downsample } =
  await import("../src/modules/monitoring/services/stats.js");

const GUILD = "300000000000000001";

test("normalizeHost entfernt Schema, Pfad und Port", () => {
  assert.equal(normalizeHost("https://gmod.example.de/pfad"), "gmod.example.de");
  assert.equal(normalizeHost("gmod.example.de:27015"), "gmod.example.de");
  assert.equal(normalizeHost("127.0.0.1"), "127.0.0.1");
  assert.equal(normalizeHost("nicht gültig!"), "");
});

test("normalizePort und normalizeInterval begrenzen die Werte", () => {
  assert.equal(normalizePort("27016"), 27016);
  assert.equal(normalizePort("0", 27015), 27015);
  assert.equal(normalizePort("99999", 27015), 27015);

  assert.equal(normalizeInterval("30"), 30);
  assert.equal(normalizeInterval("5"), 15);
  assert.equal(normalizeInterval("99999"), 3600);
  assert.equal(normalizeInterval("keine Zahl", 42), 42);
});

test("createServer legt einen Server mit Standardwerten an", () => {
  const server = createServer(GUILD, { name: "Hauptserver", host: "gmod.example.de" }, "999");

  assert.equal(server.name, "Hauptserver");
  assert.equal(server.kind, "source");
  assert.equal(server.port, 27015);
  assert.equal(server.intervalSeconds, 30);
  assert.equal(server.enabled, true);
  assert.equal(getServer(server.id).host, "gmod.example.de");
});

test("createServer weist ungültige Hosts zurück", () => {
  assert.throws(() => createServer(GUILD, { name: "Kaputt", host: "!!!" }), /Host/);
});

test("createServer übernimmt den Standard-Port des Typs", () => {
  const server = createServer(GUILD, { name: "MC", host: "mc.example.de", kind: "minecraft" });
  assert.equal(server.port, 25565);
});

test("updateServer ändert nur die übergebenen Felder", () => {
  const server = createServer(GUILD, { name: "Zweitserver", host: "zwei.example.de", intervalSeconds: 60 });
  const updated = updateServer(server.id, { intervalSeconds: 120 });

  assert.equal(updated.intervalSeconds, 120);
  assert.equal(updated.name, "Zweitserver");
  assert.equal(updated.host, "zwei.example.de");
});

test("deaktivierte Server erscheinen nicht in listAllEnabledServers", () => {
  const server = createServer(GUILD, { name: "Pausiert", host: "pause.example.de" });
  updateServer(server.id, { enabled: false });

  assert.equal(listAllEnabledServers().some((entry) => entry.id === server.id), false);
  assert.equal(listServers(GUILD).some((entry) => entry.id === server.id), true);
});

test("recordSample und getSeries liefern den Verlauf zurück", () => {
  const server = createServer(GUILD, { name: "Verlauf", host: "verlauf.example.de" });
  const now = Date.now();

  recordSample(server.id, { online: true, players: 10, maxPlayers: 32, map: "rp_city" }, now - 3000);
  recordSample(server.id, { online: true, players: 20, maxPlayers: 32, map: "rp_city" }, now - 2000);
  recordSample(server.id, { online: false }, now - 1000);

  const latest = getLatestSample(server.id);
  assert.equal(latest.online, false);

  const series = getSeries(server.id, { from: now - 10000, to: now, resolution: "raw" });
  assert.equal(series.points.length, 3);
  assert.equal(series.points[1].players, 20);
});

test("getUptime berechnet den Anteil erreichbarer Messungen", () => {
  const server = createServer(GUILD, { name: "Uptime", host: "uptime.example.de" });
  const now = Date.now();

  recordSample(server.id, { online: true, players: 1 }, now - 3000);
  recordSample(server.id, { online: true, players: 1 }, now - 2000);
  recordSample(server.id, { online: true, players: 1 }, now - 1500);
  recordSample(server.id, { online: false }, now - 1000);

  assert.equal(getUptime(server.id, 60 * 60 * 1000), 75);
});

test("getUptime liefert null ohne Messwerte", () => {
  const server = createServer(GUILD, { name: "Leer", host: "leer.example.de" });
  assert.equal(getUptime(server.id, 60 * 60 * 1000), null);
});

test("buildServerSummary fasst Kennzahlen zusammen", () => {
  const server = createServer(GUILD, { name: "Summary", host: "summary.example.de" });
  const now = Date.now();

  recordSample(server.id, { online: true, players: 10, maxPlayers: 40, map: "rp_a" }, now - 5000);
  recordSample(server.id, { online: true, players: 30, maxPlayers: 40, map: "rp_a" }, now - 1000);

  const summary = buildServerSummary(getServer(server.id), { now });

  assert.equal(summary.current.players, 30);
  assert.equal(summary.fillPercent, 75);
  assert.equal(summary.peaks.last24h.peak, 30);
  assert.equal(summary.averages.last24h, 20);
});

test("downsample verdichtet lange Reihen", () => {
  const points = Array.from({ length: 500 }, (_, index) => ({
    at: index * 1000,
    players: index % 10,
    peak: index % 10,
    maxPlayers: 32,
    online: true
  }));

  const reduced = downsample(points, 50);
  assert.ok(reduced.length <= 50);
  assert.ok(reduced.length > 0);
  assert.equal(downsample(points.slice(0, 20), 50).length, 20);
});

test("deleteServer entfernt Server und Verlauf", () => {
  const server = createServer(GUILD, { name: "Weg", host: "weg.example.de" });
  recordSample(server.id, { online: true, players: 5 });

  assert.equal(deleteServer(server.id), true);
  assert.equal(getServer(server.id), null);
  assert.equal(getLatestSample(server.id), null);
});
