import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "settings-store-test-"));
const dataDir = path.join(tempDir, "data");
fs.mkdirSync(dataDir, { recursive: true });

// Alte v1-Konfiguration ablegen, damit der Import mitgetestet wird.
fs.writeFileSync(path.join(dataDir, "module-config.json"), JSON.stringify({
  guilds: {
    "400000000000000001": {
      modules: {
        support: { enabled: true, config: { defaultDepartmentId: "support" } }
      }
    }
  }
}));

process.env.DATA_DIR = dataDir;

const { SettingsStore } = await import("../src/core/settingsStore.js");

const logger = { info() {}, warn() {}, error() {}, debug() {} };

const modules = [
  { name: "support", defaultEnabled: false, defaultConfig: { departments: [], defaultDepartmentId: "default" } },
  { name: "monitoring", defaultEnabled: false, defaultConfig: { statusChannelId: "", chartRange: "24h" } }
];

const store = new SettingsStore(modules, logger);
const GUILD = "400000000000000002";

test("Werte aus der alten module-config.json werden übernommen", () => {
  const state = store.getModuleState("400000000000000001", "support");
  assert.equal(state.enabled, true);
  assert.equal(state.config.defaultDepartmentId, "support");
});

test("fehlende Default-Werte werden ergänzt, ohne bestehende zu überschreiben", () => {
  const state = store.getModuleState("400000000000000001", "support");
  assert.deepEqual(state.config.departments, []);
});

test("neue Server bekommen die Modul-Standardwerte", () => {
  const state = store.getModuleState(GUILD, "monitoring");
  assert.equal(state.enabled, false);
  assert.equal(state.config.chartRange, "24h");
});

test("setModuleEnabled und setModuleConfig bleiben bestehen", () => {
  store.setModuleEnabled(GUILD, "monitoring", true);
  store.setModuleConfig(GUILD, "monitoring", { statusChannelId: "123456789012345678" });

  const reloaded = new SettingsStore(modules, logger).getModuleState(GUILD, "monitoring");
  assert.equal(reloaded.enabled, true);
  assert.equal(reloaded.config.statusChannelId, "123456789012345678");
  assert.equal(reloaded.config.chartRange, "24h");
});

test("isModuleEnabled spiegelt den gespeicherten Zustand", () => {
  assert.equal(store.isModuleEnabled(GUILD, "monitoring"), true);
  store.setModuleEnabled(GUILD, "monitoring", false);
  assert.equal(store.isModuleEnabled(GUILD, "monitoring"), false);
});

test("unbekannte Module liefern null", () => {
  assert.equal(store.getModuleState(GUILD, "gibt-es-nicht"), null);
  assert.equal(store.setModuleConfig(GUILD, "gibt-es-nicht", { a: 1 }), null);
});

test("Änderungen lösen Listener aus", () => {
  const seen = [];
  const unsubscribe = store.onChange((event) => seen.push(event));

  store.setModuleConfig(GUILD, "support", { defaultDepartmentId: "x" });
  unsubscribe();
  store.setModuleConfig(GUILD, "support", { defaultDepartmentId: "y" });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].moduleName, "support");
  assert.equal(seen[0].guildId, GUILD);
});

test("getGuildConfig liefert alle bekannten Module", () => {
  const config = store.getGuildConfig(GUILD);
  assert.deepEqual(Object.keys(config.modules).sort(), ["monitoring", "support"]);
});
