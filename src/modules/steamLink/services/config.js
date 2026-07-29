function safeString(value) {
  return String(value ?? "").trim();
}

function toSnowflake(value) {
  const matches = safeString(value).match(/\d{16,20}/g) || [];
  return matches.at(-1) || "";
}

export function normalizeSteamLinkConfig(rawConfig) {
  const config = rawConfig && typeof rawConfig === "object" ? rawConfig : {};

  return {
    linkedRoleId: toSnowflake(config.linkedRoleId),
    ingameCommand: safeString(config.ingameCommand) || "!discord",
    announceChannelId: toSnowflake(config.announceChannelId),
    dashboardHint: config.dashboardHint !== false,
    trackPlaytime: config.trackPlaytime !== false
  };
}

export const STEAM_LINK_DEFAULT_CONFIG = Object.freeze({
  linkedRoleId: "",
  ingameCommand: "!discord",
  announceChannelId: "",
  dashboardHint: true,
  trackPlaytime: true
});
