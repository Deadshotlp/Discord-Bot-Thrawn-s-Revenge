function safeString(value) {
  return String(value ?? "").trim();
}

function toSnowflake(value) {
  const matches = safeString(value).match(/\d{16,20}/g) || [];
  return matches.at(-1) || "";
}

function toSnowflakeList(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map(toSnowflake).filter(Boolean))];
  }

  return [...new Set((safeString(value).match(/\d{16,20}/g) || []))];
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(safeString(value), 10);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

export function normalizeAbsenceConfig(rawConfig) {
  const config = rawConfig && typeof rawConfig === "object" ? rawConfig : {};

  const departmentChannels = {};
  if (config.departmentChannels && typeof config.departmentChannels === "object") {
    for (const [departmentId, channelId] of Object.entries(config.departmentChannels)) {
      const resolved = toSnowflake(channelId);
      if (resolved) {
        departmentChannels[safeString(departmentId)] = resolved;
      }
    }
  }

  return {
    announceChannelId: toSnowflake(config.announceChannelId),
    overviewChannelId: toSnowflake(config.overviewChannelId),
    overviewMessageId: safeString(config.overviewMessageId),
    departmentChannels,
    requireApproval: config.requireApproval === true,
    notifyRoleIds: toSnowflakeList(config.notifyRoleIds),
    overviewDays: clampInteger(config.overviewDays, 7, 120, 21),
    maxDays: clampInteger(config.maxDays, 1, 365, 90),
    allowSelfService: config.allowSelfService !== false
  };
}

export const ABSENCE_DEFAULT_CONFIG = Object.freeze({
  announceChannelId: "",
  overviewChannelId: "",
  overviewMessageId: "",
  departmentChannels: {},
  requireApproval: false,
  notifyRoleIds: [],
  overviewDays: 21,
  maxDays: 90,
  allowSelfService: true
});
