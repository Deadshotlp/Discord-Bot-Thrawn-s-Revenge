import { test } from "node:test";
import assert from "node:assert/strict";

import { TEAM_LIST_DEFAULT_CONFIG, normalizeTeamListConfig } from "../src/modules/teamList/services/config.js";

test("Channel wird auch aus einer Erwähnung gelesen", () => {
  assert.equal(normalizeTeamListConfig({ panelChannelId: "<#123456789012345678>" }).panelChannelId, "123456789012345678");
  assert.equal(normalizeTeamListConfig({ panelChannelId: "123456789012345678" }).panelChannelId, "123456789012345678");
});

test("unbrauchbare Werte fallen auf die Vorgaben zurück", () => {
  const config = normalizeTeamListConfig({ panelChannelId: "kein Channel", refreshMinutes: "viel" });

  assert.equal(config.panelChannelId, "");
  assert.equal(config.refreshMinutes, TEAM_LIST_DEFAULT_CONFIG.refreshMinutes);
});

test("die Auffrischung bleibt in sinnvollen Grenzen", () => {
  assert.equal(normalizeTeamListConfig({ refreshMinutes: 1 }).refreshMinutes, 5);
  assert.equal(normalizeTeamListConfig({ refreshMinutes: 99999 }).refreshMinutes, 1440);
  assert.equal(normalizeTeamListConfig({ refreshMinutes: 60 }).refreshMinutes, 60);
});

test("ohne Konfiguration gilt die Vorgabe", () => {
  assert.deepEqual(normalizeTeamListConfig(undefined), { ...TEAM_LIST_DEFAULT_CONFIG });
});
