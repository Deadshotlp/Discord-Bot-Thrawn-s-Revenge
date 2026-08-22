function safeString(value) {
  return String(value ?? "").trim();
}

function toSnowflake(value) {
  const matches = safeString(value).match(/\d{16,20}/g) || [];
  return matches.at(-1) || "";
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(safeString(value), 10);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

export function normalizeTeamListConfig(rawConfig) {
  const config = rawConfig && typeof rawConfig === "object" ? rawConfig : {};

  return {
    panelChannelId: toSnowflake(config.panelChannelId),
    panelMessageId: safeString(config.panelMessageId),
    refreshMinutes: clampInteger(config.refreshMinutes, 5, 1440, 30)
  };
}

export const TEAM_LIST_DEFAULT_CONFIG = Object.freeze({
  panelChannelId: "",
  panelMessageId: "",
  refreshMinutes: 30
});
