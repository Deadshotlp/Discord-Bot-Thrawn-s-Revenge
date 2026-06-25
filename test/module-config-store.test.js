import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "module-config-test-"));
process.chdir(tempDir);

const { ModuleConfigStore } = await import("../src/core/moduleConfigStore.js");

const noopLogger = { warn: () => {} };

function makeModules() {
  return [
    { name: "alpha", defaultEnabled: true, defaultConfig: { foo: "bar" } },
    { name: "beta", defaultEnabled: false, defaultConfig: {} }
  ];
}

test("ensureGuild applies module defaults for a new guild", () => {
  const store = new ModuleConfigStore(makeModules(), noopLogger);
  const guildConfig = store.getGuildConfig("guild1");
  assert.equal(guildConfig.modules.alpha.enabled, true);
  assert.equal(guildConfig.modules.beta.enabled, false);
  assert.equal(guildConfig.modules.alpha.config.foo, "bar");
});

test("setModuleEnabled toggles and persists the enabled flag", () => {
  const store = new ModuleConfigStore(makeModules(), noopLogger);
  store.setModuleEnabled("guild2", "beta", true);
  assert.equal(store.isModuleEnabled("guild2", "beta"), true);
});

test("setModuleConfig merges fields without dropping existing config", () => {
  const store = new ModuleConfigStore(makeModules(), noopLogger);
  store.setModuleConfig("guild3", "alpha", { extra: "value" });
  const state = store.getModuleState("guild3", "alpha");
  assert.equal(state.config.foo, "bar");
  assert.equal(state.config.extra, "value");
});

test("state survives a reload from disk after an atomic write", () => {
  const store = new ModuleConfigStore(makeModules(), noopLogger);
  store.setModuleEnabled("guild4", "alpha", false);

  const reloaded = new ModuleConfigStore(makeModules(), noopLogger);
  assert.equal(reloaded.isModuleEnabled("guild4", "alpha"), false);
});

test("loadState recovers from a corrupted config file instead of crashing", () => {
  const filePath = path.join(tempDir, "data", "module-config.json");
  fs.writeFileSync(filePath, "{not valid json");

  let warned = false;
  const logger = { warn: () => { warned = true; } };
  const store = new ModuleConfigStore(makeModules(), logger);

  assert.equal(warned, true);
  assert.deepEqual(store.state.guilds, {});
});
