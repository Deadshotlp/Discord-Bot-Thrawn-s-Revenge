import "dotenv/config";

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return ["true", "1", "yes", "on"].includes(String(value).toLowerCase());
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
  autoSetupChannelOnGuildJoin: parseBoolean(
    process.env.AUTO_SETUP_CHANNEL_ON_GUILD_JOIN ?? process.env.FORCE_SETUP_ON_GUILD_JOIN,
    true
  )
};
