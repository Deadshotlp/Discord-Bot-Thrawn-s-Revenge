const CHART_RANGES = new Set(["24h", "7d", "30d"]);

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

export function normalizeMonitoringConfig(rawConfig) {
  const config = rawConfig && typeof rawConfig === "object" ? rawConfig : {};

  return {
    statusChannelId: toSnowflake(config.statusChannelId),
    statusMessageId: safeString(config.statusMessageId),
    panelIntervalSeconds: clampInteger(config.panelIntervalSeconds, 30, 3600, 120),
    chartRange: CHART_RANGES.has(config.chartRange) ? config.chartRange : "24h",
    showHourProfile: config.showHourProfile !== false,
    alertOnStateChange: config.alertOnStateChange !== false,
    alertChannelId: toSnowflake(config.alertChannelId),
    alertRoleId: toSnowflake(config.alertRoleId),
    publicStats: config.publicStats === true
  };
}

export const MONITORING_DEFAULT_CONFIG = Object.freeze({
  statusChannelId: "",
  statusMessageId: "",
  panelIntervalSeconds: 120,
  chartRange: "24h",
  showHourProfile: true,
  alertOnStateChange: true,
  alertChannelId: "",
  alertRoleId: "",
  publicStats: false
});
