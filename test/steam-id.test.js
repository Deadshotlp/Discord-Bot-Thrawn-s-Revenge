import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeSteamId,
  parseSteamId,
  toClassicSteamId,
  toSteam3
} from "../src/modules/steamLink/services/steamId.js";

// 76561197960265728 ist die Basis für SteamID64; 40000000 ist die Account-ID.
const STEAM64 = "76561198000265728";
const CLASSIC = "STEAM_0:0:20000000";
const STEAM3 = "[U:1:40000000]";

test("parseSteamId akzeptiert eine SteamID64", () => {
  assert.equal(parseSteamId(STEAM64), STEAM64);
});

test("parseSteamId rechnet das klassische Format um", () => {
  assert.equal(parseSteamId(CLASSIC), STEAM64);
  assert.equal(parseSteamId("STEAM_1:1:20000000"), "76561198000265729");
});

test("parseSteamId rechnet das Steam3-Format um", () => {
  assert.equal(parseSteamId(STEAM3), STEAM64);
  assert.equal(parseSteamId("U:1:40000000"), STEAM64);
});

test("parseSteamId erkennt Profil-Links", () => {
  assert.equal(parseSteamId(`https://steamcommunity.com/profiles/${STEAM64}`), STEAM64);
});

test("parseSteamId lehnt ungültige Eingaben ab", () => {
  assert.equal(parseSteamId(""), null);
  assert.equal(parseSteamId("nicht-eine-id"), null);
  assert.equal(parseSteamId("12345"), null);
  assert.equal(parseSteamId("10000000000000000"), null);
});

test("Rückumrechnung ergibt wieder dieselbe ID", () => {
  assert.equal(parseSteamId(toClassicSteamId(STEAM64)), STEAM64);
  assert.equal(parseSteamId(toSteam3(STEAM64)), STEAM64);
});

test("describeSteamId liefert alle Darstellungen", () => {
  const described = describeSteamId(STEAM64);

  assert.equal(described.steamId64, STEAM64);
  assert.equal(described.classic, CLASSIC);
  assert.equal(described.steam3, STEAM3);
  assert.equal(described.profileUrl, `https://steamcommunity.com/profiles/${STEAM64}`);
});
