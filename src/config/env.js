import "dotenv/config";

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return ["true", "1", "yes", "on"].includes(String(value).toLowerCase());
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return parsed;
}

function parseSnowflakeList(value) {
  const text = String(value || "").trim();
  if (!text) {
    return [];
  }

  const matches = text.match(/\d{16,20}/g) || [];
  return [...new Set(matches)];
}

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Umgebungsvariable fehlt: ${name}`);
  }

  return value;
}

export const env = {
  discordToken: getRequiredEnv("DISCORD_TOKEN"),
  logLevel: process.env.LOG_LEVEL || "info",
  setupChannelName: process.env.SETUP_CHANNEL_NAME || "bot-setup",
  verifyDefaultRoleName: process.env.VERIFY_DEFAULT_ROLE_NAME || "Verifiziert",
  verifyDefaultChannelName: process.env.VERIFY_DEFAULT_CHANNEL_NAME || "verify",
  supportWaitingChannelName: process.env.SUPPORT_WAITING_CHANNEL_NAME || "support-warteraum",
  supportManagementChannelName: process.env.SUPPORT_MANAGEMENT_CHANNEL_NAME || "support-verwaltung",
  supportTalkCategoryName: process.env.SUPPORT_TALK_CATEGORY_NAME || "Support Talk",
  supportTicketCategoryName: process.env.SUPPORT_TICKET_CATEGORY_NAME || "Support Tickets",
  supportTalkChannelPrefix: process.env.SUPPORT_TALK_CHANNEL_PREFIX || "support-talk",
  supportTalkChannelCount: parseInteger(process.env.SUPPORT_TALK_CHANNEL_COUNT, 3),
  supportDefaultDepartmentName: process.env.SUPPORT_DEFAULT_DEPARTMENT_NAME || "Support",
  supportDefaultDepartmentRoleIdsRaw: process.env.SUPPORT_DEFAULT_DEPARTMENT_ROLE_IDS || "",
  supportDefaultDepartmentRoleIds: parseSnowflakeList(process.env.SUPPORT_DEFAULT_DEPARTMENT_ROLE_IDS || ""),
  autoSetupChannelOnGuildJoin: parseBoolean(
    process.env.AUTO_SETUP_CHANNEL_ON_GUILD_JOIN ?? process.env.FORCE_SETUP_ON_GUILD_JOIN,
    true
  )
};
