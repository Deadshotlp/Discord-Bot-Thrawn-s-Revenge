import fs from "node:fs";
import path from "node:path";

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeModules(modules) {
  const defaults = {};

  for (const moduleDef of modules) {
    defaults[moduleDef.name] = {
      enabled: moduleDef.defaultEnabled ?? true,
      config: cloneJson(moduleDef.defaultConfig || {})
    };
  }

  return defaults;
}

export class ModuleConfigStore {
  constructor(modules, logger) {
    this.logger = logger;
    this.filePath = path.join(process.cwd(), "data", "module-config.json");
    this.moduleDefaults = normalizeModules(modules);

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.state = this.loadState();
  }

  loadState() {
    if (!fs.existsSync(this.filePath)) {
      return { guilds: {} };
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      if (!parsed || typeof parsed !== "object") {
        return { guilds: {} };
      }

      if (!parsed.guilds || typeof parsed.guilds !== "object") {
        parsed.guilds = {};
      }

      return parsed;
    } catch (error) {
      this.logger.warn("ModuleConfigStore konnte nicht geladen werden, verwende leeren Zustand", {
        error: String(error)
      });
      return { guilds: {} };
    }
  }

  saveState() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  ensureGuild(guildId) {
    if (!this.state.guilds[guildId]) {
      this.state.guilds[guildId] = { modules: {} };
    }

    const guildModules = this.state.guilds[guildId].modules;
    let changed = false;

    for (const [moduleName, defaults] of Object.entries(this.moduleDefaults)) {
      if (!guildModules[moduleName]) {
        guildModules[moduleName] = cloneJson(defaults);
        changed = true;
        continue;
      }

      if (typeof guildModules[moduleName].enabled !== "boolean") {
        guildModules[moduleName].enabled = defaults.enabled;
        changed = true;
      }

      if (!guildModules[moduleName].config || typeof guildModules[moduleName].config !== "object") {
        guildModules[moduleName].config = cloneJson(defaults.config || {});
        changed = true;
      }

      const currentConfig = guildModules[moduleName].config;
      const defaultConfig = defaults.config || {};

      for (const [key, defaultValue] of Object.entries(defaultConfig)) {
        if (!(key in currentConfig)) {
          currentConfig[key] = defaultValue;
          changed = true;
        }
      }
    }

    if (changed) {
      this.saveState();
    }

    return this.state.guilds[guildId];
  }

  getGuildConfig(guildId) {
    return this.ensureGuild(guildId);
  }

  ensureModuleState(guildId, moduleName) {
    const guildConfig = this.ensureGuild(guildId);
    if (guildConfig.modules[moduleName]) {
      return guildConfig.modules[moduleName];
    }

    const defaults = this.moduleDefaults[moduleName];
    if (!defaults) {
      return null;
    }

    guildConfig.modules[moduleName] = cloneJson(defaults);
    this.saveState();
    return guildConfig.modules[moduleName];
  }

  getModuleState(guildId, moduleName) {
    return this.ensureModuleState(guildId, moduleName);
  }

  isModuleEnabled(guildId, moduleName) {
    const moduleState = this.getModuleState(guildId, moduleName);
    return Boolean(moduleState?.enabled);
  }

  setModuleEnabled(guildId, moduleName, enabled) {
    const moduleState = this.ensureModuleState(guildId, moduleName);
    if (!moduleState) {
      return null;
    }

    moduleState.enabled = Boolean(enabled);
    this.saveState();
    return moduleState;
  }

  setModuleConfig(guildId, moduleName, fields) {
    const moduleState = this.ensureModuleState(guildId, moduleName);
    if (!moduleState) {
      return null;
    }

    const currentConfig = moduleState.config || {};
    moduleState.config = {
      ...currentConfig,
      ...fields
    };

    this.saveState();
    return moduleState;
  }
}
