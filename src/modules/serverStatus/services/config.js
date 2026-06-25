const DEFAULT_PORT = 27015;
const HOST_PATTERN = /^[a-z0-9.-]+$/i;

function safeString(value) {
  return String(value || "").trim();
}

function toSnowflake(value) {
  const text = safeString(value);
  if (!text) {
    return "";
  }

  const matches = text.match(/\d{16,20}/g) || [];
  return matches.at(-1) || "";
}

export function normalizeServerHost(value) {
  const text = safeString(value).replace(/^https?:\/\//i, "").split("/")[0];
  return HOST_PATTERN.test(text) ? text : "";
}

export function normalizeServerPort(value, fallback = DEFAULT_PORT) {
  const parsed = Number.parseInt(safeString(value), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return fallback;
  }

  return parsed;
}

export function normalizeServerStatusConfig(rawConfig) {
  const config = rawConfig && typeof rawConfig === "object" ? rawConfig : {};

  return {
    serverHost: normalizeServerHost(config.serverHost),
    serverPort: normalizeServerPort(config.serverPort, DEFAULT_PORT),
    statusChannelId: toSnowflake(config.statusChannelId),
    statusMessageId: safeString(config.statusMessageId),
    lastOnline: Boolean(config.lastOnline),
    lastMap: safeString(config.lastMap),
    lastPlayers: Number.isInteger(config.lastPlayers) ? config.lastPlayers : 0,
    lastMaxPlayers: Number.isInteger(config.lastMaxPlayers) ? config.lastMaxPlayers : 0
  };
}

export { DEFAULT_PORT };
