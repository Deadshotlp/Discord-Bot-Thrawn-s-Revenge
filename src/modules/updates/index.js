import { MessageFlags } from "discord.js";
import { updatesChannelCommand } from "./commands/updatesChannel.js";
import { updatesRepoCommand } from "./commands/updatesRepo.js";
import { changelogCommand, CHANGELOG_MODAL_ID, CHANGELOG_NOTES_MAX_LENGTH } from "./commands/changelog.js";
import { buildChangelogEmbeds, formatChangelogDate } from "./services/embeds.js";
import { startUpdatesPolling } from "./services/poll.js";

function nextChangelogSequence(moduleConfigStore, guildId, state, date) {
  const dateKey = formatChangelogDate(date);
  const previous = state?.config?.changelogSequence;
  const sequence = previous?.dateKey === dateKey ? previous.count + 1 : 1;

  moduleConfigStore.setModuleConfig(guildId, "updates", {
    ...(state?.config || {}),
    changelogSequence: { dateKey, count: sequence }
  });

  return sequence;
}

async function handleChangelogModalSubmit({ client, interaction }) {
  if (!interaction.isModalSubmit() || interaction.customId !== CHANGELOG_MODAL_ID) {
    return;
  }

  if (!interaction.inGuild()) {
    return;
  }

  const { moduleConfigStore } = client.botContext;
  const state = moduleConfigStore.getModuleState(interaction.guildId, "updates");
  const channelId = state?.config?.channelId;

  if (!channelId) {
    await interaction.reply({
      content: "Es ist noch kein Updates-Kanal konfiguriert. Nutze zuerst `/updates-channel`.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const channel = interaction.guild.channels.cache.get(channelId)
    || (await interaction.guild.channels.fetch(channelId).catch(() => null));

  if (!channel || !channel.isTextBased()) {
    await interaction.reply({
      content: "Der konfigurierte Updates-Kanal wurde nicht gefunden.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const category = interaction.fields.getTextInputValue("changelog_category").trim();
  const notes = interaction.fields.getTextInputValue("changelog_notes").trim().slice(0, CHANGELOG_NOTES_MAX_LENGTH);

  const date = new Date();
  const sequence = nextChangelogSequence(moduleConfigStore, interaction.guildId, state, date);

  const embeds = buildChangelogEmbeds({ category, notes, sequence, date });
  await channel.send({ embeds });

  await interaction.reply({
    content: `Changelog wurde in <#${channelId}> gepostet.`,
    flags: MessageFlags.Ephemeral
  });
}

async function handleUpdatesReady({ client }) {
  if (client.botContext.updatesPollingStarted) {
    return;
  }

  client.botContext.updatesPollingStarted = true;
  startUpdatesPolling(client);
}

export const updatesModule = {
  name: "updates",
  defaultEnabled: false,
  defaultConfig: {
    channelId: "",
    repos: []
  },
  commands: [updatesChannelCommand, updatesRepoCommand, changelogCommand],
  events: {
    interactionCreate: [handleChangelogModalSubmit],
    ready: [handleUpdatesReady]
  }
};
