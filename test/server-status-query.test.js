import { test } from "node:test";
import assert from "node:assert/strict";
import { parseA2SInfoResponse } from "../src/modules/serverStatus/services/query.js";

function buildInfoResponseBody({
  name = "Test Server",
  map = "gm_construct",
  folder = "garrysmod",
  game = "Garry's Mod",
  appId = 4000,
  players = 12,
  maxPlayers = 32,
  bots = 0
}) {
  const appIdBuffer = Buffer.alloc(2);
  appIdBuffer.writeUInt16LE(appId, 0);

  return Buffer.concat([
    Buffer.from([0x49]), // type 'I'
    Buffer.from([17]), // protocol version
    Buffer.from(`${name}\0`, "utf8"),
    Buffer.from(`${map}\0`, "utf8"),
    Buffer.from(`${folder}\0`, "utf8"),
    Buffer.from(`${game}\0`, "utf8"),
    appIdBuffer,
    Buffer.from([players, maxPlayers, bots])
  ]);
}

test("parseA2SInfoResponse extracts name, map, folder, game and player counts", () => {
  const body = buildInfoResponseBody({});
  const info = parseA2SInfoResponse(body);

  assert.equal(info.name, "Test Server");
  assert.equal(info.map, "gm_construct");
  assert.equal(info.folder, "garrysmod");
  assert.equal(info.game, "Garry's Mod");
  assert.equal(info.players, 12);
  assert.equal(info.maxPlayers, 32);
  assert.equal(info.bots, 0);
});

test("parseA2SInfoResponse returns null for a non-info type byte", () => {
  const body = Buffer.from([0x41, 0, 0, 0, 0]);
  assert.equal(parseA2SInfoResponse(body), null);
});

test("parseA2SInfoResponse returns null for a truncated buffer", () => {
  const body = Buffer.from([0x49, 17, 0x00]);
  assert.equal(parseA2SInfoResponse(body), null);
});

test("parseA2SInfoResponse handles an empty server name", () => {
  const body = buildInfoResponseBody({ name: "" });
  const info = parseA2SInfoResponse(body);
  assert.equal(info.name, "");
  assert.equal(info.map, "gm_construct");
});
