import { test } from "node:test";
import assert from "node:assert/strict";
import { parseA2SInfoResponse, parseA2SPlayerResponse } from "../src/modules/monitoring/services/protocols/a2s.js";

function buildInfoResponseBody({
  name = "Test Server",
  map = "gm_construct",
  folder = "garrysmod",
  game = "Garry's Mod",
  appId = 4000,
  players = 12,
  maxPlayers = 32,
  bots = 0,
  version = "2024.10.29"
} = {}) {
  const appIdBuffer = Buffer.alloc(2);
  appIdBuffer.writeUInt16LE(appId, 0);

  return Buffer.concat([
    Buffer.from([0x49]), // Typ 'I'
    Buffer.from([17]), // Protokollversion
    Buffer.from(`${name}\0`, "utf8"),
    Buffer.from(`${map}\0`, "utf8"),
    Buffer.from(`${folder}\0`, "utf8"),
    Buffer.from(`${game}\0`, "utf8"),
    appIdBuffer,
    Buffer.from([players, maxPlayers, bots]),
    Buffer.from([0x64, 0x6c, 0x00, 0x00]), // serverType, environment, visibility, vac
    Buffer.from(`${version}\0`, "utf8")
  ]);
}

function buildPlayerResponseBody(players) {
  const parts = [Buffer.from([0x44, players.length])];

  for (const player of players) {
    const numbers = Buffer.alloc(8);
    numbers.writeInt32LE(player.score, 0);
    numbers.writeFloatLE(player.duration, 4);

    parts.push(Buffer.from([0]), Buffer.from(`${player.name}\0`, "utf8"), numbers);
  }

  return Buffer.concat(parts);
}

test("parseA2SInfoResponse liest Name, Map, Spielerzahlen und Version", () => {
  const info = parseA2SInfoResponse(buildInfoResponseBody());

  assert.equal(info.name, "Test Server");
  assert.equal(info.map, "gm_construct");
  assert.equal(info.folder, "garrysmod");
  assert.equal(info.game, "Garry's Mod");
  assert.equal(info.players, 12);
  assert.equal(info.maxPlayers, 32);
  assert.equal(info.bots, 0);
  assert.equal(info.version, "2024.10.29");
});

test("parseA2SInfoResponse gibt null bei falschem Typ-Byte zurück", () => {
  assert.equal(parseA2SInfoResponse(Buffer.from([0x41, 0, 0, 0, 0])), null);
});

test("parseA2SInfoResponse gibt null bei abgeschnittener Antwort zurück", () => {
  assert.equal(parseA2SInfoResponse(Buffer.from([0x49, 17, 0x00])), null);
});

test("parseA2SInfoResponse kommt mit leerem Servernamen zurecht", () => {
  const info = parseA2SInfoResponse(buildInfoResponseBody({ name: "" }));
  assert.equal(info.name, "");
  assert.equal(info.map, "gm_construct");
});

test("parseA2SPlayerResponse liest die Spielerliste", () => {
  const players = parseA2SPlayerResponse(buildPlayerResponseBody([
    { name: "Alice", score: 5, duration: 120.5 },
    { name: "Bob", score: 0, duration: 3600 }
  ]));

  assert.equal(players.length, 2);
  assert.deepEqual(players[0], { name: "Alice", score: 5, durationSeconds: 121 });
  assert.equal(players[1].name, "Bob");
  assert.equal(players[1].durationSeconds, 3600);
});

test("parseA2SPlayerResponse gibt null bei falschem Typ zurück", () => {
  assert.equal(parseA2SPlayerResponse(Buffer.from([0x49, 0])), null);
});
