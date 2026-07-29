import fs from "node:fs";
import path from "node:path";
import { db } from "./db.js";
import { dataDir } from "./dataDir.js";

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(String(value ?? ""));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

const selectRowStmt = db.prepare(
  "SELECT enabled, config_json FROM guild_modules WHERE guild_id = ? AND module = ?"
);

const selectGuildRowsStmt = db.prepare(
  "SELECT module, enabled, config_json FROM guild_modules WHERE guild_id = ?"
);

const selectGuildIdsStmt = db.prepare(
  "SELECT DISTINCT guild_id FROM guild_modules"
);

const upsertRowStmt = db.prepare(`
  INSERT INTO guild_modules (guild_id, module, enabled, config_json, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (guild_id, module) DO UPDATE SET
    enabled = excluded.enabled,
    config_json = excluded.config_json,
    updated_at = excluded.updated_at
`);

/**
 * Modul-Einstellungen pro Server.
 *
 * Die öffentliche API ist absichtlich identisch zum früheren JSON-Store,
 * damit bestehende Module unverändert weiterlaufen. Neu sind Change-Listener,
 * über die das Web-Dashboard laufende Module sofort neu konfigurieren kann.
 */
export class SettingsStore {
  constructor(modules, logger) {
    this.logger = logger;
    this.listeners = new Set();
    this.moduleDefaults = {};

    for (const moduleDef of modules) {
      this.moduleDefaults[moduleDef.name] = {
        enabled: moduleDef.defaultEnabled ?? true,
        config: cloneJson(moduleDef.defaultConfig || {})
      };
    }

    this.importLegacyJsonOnce();
  }

  // Einmalige Übernahme aus data/module-config.json (v1-Format).
  importLegacyJsonOnce() {
    const legacyPath = path.join(dataDir, "module-config.json");
    const markerPath = path.join(dataDir, "module-config.json.imported");

    if (!fs.existsSync(legacyPath) || fs.existsSync(markerPath)) {
      return;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
      const guilds = parsed?.guilds && typeof parsed.guilds === "object" ? parsed.guilds : {};
      let imported = 0;

      const importAll = db.transaction(() => {
        for (const [guildId, guildState] of Object.entries(guilds)) {
          const guildModules = guildState?.modules || {};
          for (const [moduleName, moduleState] of Object.entries(guildModules)) {
            if (selectRowStmt.get(guildId, moduleName)) {
              continue;
            }

            upsertRowStmt.run(
              guildId,
              moduleName,
              moduleState?.enabled ? 1 : 0,
              JSON.stringify(moduleState?.config || {}),
              Date.now()
            );
            imported += 1;
          }
        }
      });

      importAll();
      fs.writeFileSync(markerPath, new Date().toISOString());
      this.logger.info("Modul-Einstellungen aus module-config.json übernommen", { imported });
    } catch (error) {
      this.logger.warn("Import der alten module-config.json fehlgeschlagen", {
        error: String(error)
      });
    }
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emitChange(guildId, moduleName) {
    for (const listener of this.listeners) {
      try {
        listener({ guildId, moduleName });
      } catch (error) {
        this.logger.warn("Settings-Listener fehlgeschlagen", {
          module: moduleName,
          error: String(error)
        });
      }
    }
  }

  knownModules() {
    return Object.keys(this.moduleDefaults);
  }

  knownGuildIds() {
    return selectGuildIdsStmt.all().map((row) => String(row.guild_id));
  }

  // Füllt fehlende Default-Werte auf, ohne bestehende Werte zu überschreiben.
  mergeDefaults(moduleName, storedEnabled, storedConfig) {
    const defaults = this.moduleDefaults[moduleName];
    if (!defaults) {
      return { enabled: Boolean(storedEnabled), config: storedConfig || {} };
    }

    const config = { ...cloneJson(defaults.config), ...(storedConfig || {}) };
    return {
      enabled: typeof storedEnabled === "boolean" ? storedEnabled : defaults.enabled,
      config
    };
  }

  ensureModuleState(guildId, moduleName) {
    const defaults = this.moduleDefaults[moduleName];
    const row = selectRowStmt.get(guildId, moduleName);

    if (!row) {
      if (!defaults) {
        return null;
      }

      const state = { enabled: defaults.enabled, config: cloneJson(defaults.config) };
      upsertRowStmt.run(
        guildId,
        moduleName,
        state.enabled ? 1 : 0,
        JSON.stringify(state.config),
        Date.now()
      );
      return state;
    }

    return this.mergeDefaults(moduleName, Boolean(row.enabled), parseJson(row.config_json, {}));
  }

  getModuleState(guildId, moduleName) {
    return this.ensureModuleState(guildId, moduleName);
  }

  // Legt fehlende Modul-Zeilen für einen Server an (beim Join / Start).
  ensureGuild(guildId) {
    return this.getGuildConfig(guildId);
  }

  getGuildConfig(guildId) {
    const modules = {};
    for (const moduleName of this.knownModules()) {
      modules[moduleName] = this.ensureModuleState(guildId, moduleName);
    }

    for (const row of selectGuildRowsStmt.all(guildId)) {
      if (!modules[row.module]) {
        modules[row.module] = {
          enabled: Boolean(row.enabled),
          config: parseJson(row.config_json, {})
        };
      }
    }

    return { modules };
  }

  isModuleEnabled(guildId, moduleName) {
    return Boolean(this.ensureModuleState(guildId, moduleName)?.enabled);
  }

  setModuleEnabled(guildId, moduleName, enabled) {
    const state = this.ensureModuleState(guildId, moduleName);
    if (!state) {
      return null;
    }

    state.enabled = Boolean(enabled);
    upsertRowStmt.run(guildId, moduleName, state.enabled ? 1 : 0, JSON.stringify(state.config), Date.now());
    this.emitChange(guildId, moduleName);
    return state;
  }

  setModuleConfig(guildId, moduleName, fields) {
    const state = this.ensureModuleState(guildId, moduleName);
    if (!state) {
      return null;
    }

    state.config = { ...state.config, ...fields };
    upsertRowStmt.run(guildId, moduleName, state.enabled ? 1 : 0, JSON.stringify(state.config), Date.now());
    this.emitChange(guildId, moduleName);
    return state;
  }
}
