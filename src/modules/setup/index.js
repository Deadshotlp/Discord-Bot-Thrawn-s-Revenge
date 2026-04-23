import { setupPanelCommand } from "./commands/setupPanel.js";
import { ensureSetupChannel } from "./services/ensureSetupChannel.js";
import { postSetupPanel } from "./services/panel.js";

async function handleGuildCreate({ client, guild }) {
  const { env, logger } = client.botContext;

  if (!env.autoSetupChannelOnGuildJoin) {
    return;
  }

  const { channel, created } = await ensureSetupChannel(guild, env.setupChannelName, logger);

  if (channel && created) {
    await postSetupPanel(channel);
    logger.info("Setup-Channel erstellt und Panel gepostet", {
      guildId: guild.id,
      channelId: channel.id
    });
  }
}

export const setupModule = {
  name: "setup",
  commands: [setupPanelCommand],
  events: {
    guildCreate: [handleGuildCreate]
  }
};
