import { MessageFlags } from "discord.js";
import { updatesChannelCommand } from "./commands/updatesChannel.js";
import { updatesRepoCommand } from "./commands/updatesRepo.js";
import { changelogCommand, CHANGELOG_MODAL_ID, CHANGELOG_NOTES_MAX_LENGTH } from "./commands/changelog.js";
import { buildChangelogEmbed } from "./services/embeds.js";
import { startUpdatesPolling } from "./services/poll.js";

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

  const title = interaction.fields.getTextInputValue("changelog_title").trim();
  const version = interaction.fields.getTextInputValue("changelog_version")?.trim() || "";
  const notes = interaction.fields.getTextInputValue("changelog_notes").trim().slice(0, CHANGELOG_NOTES_MAX_LENGTH);

  const embed = buildChangelogEmbed({ title, version, notes, author: interaction.user.tag });
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
    repos: []
  },
  commands: [updatesChannelCommand, updatesRepoCommand, changelogCommand],
  events: {
    interactionCreate: [handleChangelogModalSubmit],
    ready: [handleUpdatesReady]
  }
};
