import { fetchLatestUpdate } from "./github.js";
import { buildRepoUpdateEmbed } from "./embeds.js";

async function pollGuild(client, guild) {
  const { moduleConfigStore, logger, env } = client.botContext;

  if (!moduleConfigStore.isModuleEnabled(guild.id, "updates")) {
    return;
  }

  const state = moduleConfigStore.getModuleState(guild.id, "updates");
  const config = state?.config || {};
  const channelId = config.channelId;
  const repos = Array.isArray(config.repos) ? config.repos : [];

  if (!channelId || repos.length === 0) {
    return;
  }

  const channel = guild.channels.cache.get(channelId)
    || (await guild.channels.fetch(channelId).catch(() => null));

  if (!channel || !channel.isTextBased()) {
    return;
  }

  let changed = false;

  for (const repoEntry of repos) {
    try {
      const update = await fetchLatestUpdate(repoEntry.owner, repoEntry.repo, env.githubToken);
      if (!update || update.id === repoEntry.lastSeenId) {
        continue;
      }

      if (repoEntry.lastSeenId) {
        await channel.send({ embeds: [buildRepoUpdateEmbed(repoEntry, update)] });
      }

      repoEntry.lastSeenId = update.id;
      changed = true;
    } catch (error) {
      logger.warn("Update-Check fehlgeschlagen", {
        guildId: guild.id,
        repo: `${repoEntry.owner}/${repoEntry.repo}`,
        error: String(error)
      });
    }
  }

  if (changed) {
    moduleConfigStore.setModuleConfig(guild.id, "updates", { ...config, repos });
  }
}

async function runPollCycle(client) {
  for (const guild of client.guilds.cache.values()) {
    await pollGuild(client, guild);
  }
}

export function startUpdatesPolling(client) {
  const { logger, env } = client.botContext;
  const intervalMs = Math.max(5, env.updatesPollIntervalMinutes) * 60 * 1000;

  const runSafely = () => {
    runPollCycle(client).catch((error) => {
      logger.warn("Update-Polling fehlgeschlagen", { error: String(error) });
    });
  };

  runSafely();
  setInterval(runSafely, intervalMs);
}
