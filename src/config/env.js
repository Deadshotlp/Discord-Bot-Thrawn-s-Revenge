import dotenv from "dotenv";

dotenv.config();

function parseBoolean(value, fallback = false) {
  if (value === undefined) {
    return fallback;
  }

  return ["true", "1", "yes", "on"].includes(String(value).toLowerCase());
}

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Fehlende Umgebungsvariable: ${name}`);
  }
  return value;
}

export const env = {
  discordToken: getRequiredEnv("DISCORD_TOKEN"),
  setupChannelName: process.env.SETUP_CHANNEL_NAME || "bot-setup",
  forceSetupOnGuildJoin: parseBoolean(process.env.FORCE_SETUP_ON_GUILD_JOIN, true),
  logLevel: process.env.LOG_LEVEL || "info"
};
