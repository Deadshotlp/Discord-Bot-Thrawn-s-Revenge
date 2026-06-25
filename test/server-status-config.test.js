import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeServerHost,
  normalizeServerPort,
  normalizeServerStatusConfig
} from "../src/modules/serverStatus/services/config.js";

test("normalizeServerHost accepts a plain IP", () => {
  assert.equal(normalizeServerHost("123.45.67.89"), "123.45.67.89");
});

test("normalizeServerHost accepts a hostname and strips a protocol prefix", () => {
  assert.equal(normalizeServerHost("https://play.example.com"), "play.example.com");
});

test("normalizeServerHost rejects input with spaces or invalid characters", () => {
  assert.equal(normalizeServerHost("not a host!"), "");
});

test("normalizeServerPort falls back to the default for out-of-range values", () => {
  assert.equal(normalizeServerPort("70000"), 27015);
  assert.equal(normalizeServerPort("0"), 27015);
  assert.equal(normalizeServerPort("abc"), 27015);
});

test("normalizeServerPort accepts a valid port", () => {
  assert.equal(normalizeServerPort("27016"), 27016);
});

test("normalizeServerStatusConfig fills in defaults for missing fields", () => {
  const config = normalizeServerStatusConfig({});
  assert.equal(config.serverHost, "");
  assert.equal(config.serverPort, 27015);
  assert.equal(config.statusChannelId, "");
  assert.equal(config.lastOnline, false);
});

test("normalizeServerStatusConfig preserves valid existing values", () => {
  const config = normalizeServerStatusConfig({
    serverHost: "203.0.113.5",
    serverPort: "27017",
    statusChannelId: "123456789012345678",
    lastOnline: true,
    lastMap: "gm_flatgrass",
    lastPlayers: 5,
    lastMaxPlayers: 20
  });

  assert.equal(config.serverHost, "203.0.113.5");
  assert.equal(config.serverPort, 27017);
  assert.equal(config.statusChannelId, "123456789012345678");
  assert.equal(config.lastOnline, true);
  assert.equal(config.lastMap, "gm_flatgrass");
  assert.equal(config.lastPlayers, 5);
  assert.equal(config.lastMaxPlayers, 20);
});
