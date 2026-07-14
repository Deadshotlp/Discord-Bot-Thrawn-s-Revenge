import { MessageFlags } from "discord.js";
import { updatesChannelCommand } from "./commands/updatesChannel.js";
import { updatesRepoCommand } from "./commands/updatesRepo.js";
import { changelogCommand, CHANGELOG_MODAL_ID, CHANGELOG_NOTES_MAX_LENGTH, canPostChangelog } from "./commands/changelog.js";
import { buildChangelogEmbed, formatChangelogDate } from "./services/embeds.js";
import { startUpdatesPolling } from "./services/poll.js";

function nextChangelogSequence(moduleConfigStore, guildId, state, date, category) {
  const dateKey = formatChangelogDate(date);
  const categoryKey = category.trim().toLowerCase();
  const sequences = state?.config?.changelogSequence && typeof state.config.changelogSequence === "object"
    ? state.config.changelogSequence
    : {};
  const previous = sequences[categoryKey];
  const sequence = previous?.dateKey === dateKey ? previous.count + 1 : 1;

  moduleConfigStore.setModuleConfig(guildId, "updates", {
    ...(state?.config || {}),
    changelogSequence: {
      ...sequences,
      [categoryKey]: { dateKey, count: sequence }
    }
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

  if (!canPostChangelog(interaction.member, state?.config)) {
    await interaction.reply({
      content: "Diesen Befehl dürfen nur Admins, Mitglieder mit Server-verwalten oder berechtigte Rollen nutzen.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

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
  const sequence = nextChangelogSequence(moduleConfigStore, interaction.guildId, state, date, category);

  const embed = buildChangelogEmbed({
    category,
    notes,
    sequence,
    date,
    author: interaction.member?.displayName || interaction.user.username,
    authorAvatarUrl: interaction.user.displayAvatarURL()
  });
  await channel.send({ embeds: [embed] });

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
    repos: [],
    changelogRoleIds: []
  },
  commands: [updatesChannelCommand, updatesRepoCommand, changelogCommand],
  events: {
    interactionCreate: [handleChangelogModalSubmit],
    ready: [handleUpdatesReady]
  }
};
