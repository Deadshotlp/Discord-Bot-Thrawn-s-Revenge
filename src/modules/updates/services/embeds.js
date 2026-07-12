import { EmbedBuilder } from "discord.js";

const DESCRIPTION_MAX_LENGTH = 4000;

export function buildRepoUpdateEmbed(repoEntry, update) {
  const displayName = repoEntry.label || `${repoEntry.owner}/${repoEntry.repo}`;
  const kindLabel = update.type === "release" ? "Neues Release" : "Neuer Commit";

  const embed = new EmbedBuilder()
    .setColor(0x2ea043)
    .setTitle(`${displayName} — ${kindLabel}`)
    .setURL(update.url)
    .addFields({ name: "Version", value: update.version || "-", inline: true })
    .setFooter({ text: `${repoEntry.owner}/${repoEntry.repo}` });

  if (update.author) {
    embed.addFields({ name: "Autor", value: update.author, inline: true });
  }

  if (update.body) {
    embed.setDescription(update.body.slice(0, DESCRIPTION_MAX_LENGTH));
  }

  if (update.publishedAt) {
    embed.setTimestamp(new Date(update.publishedAt));
  }

  return embed;
}

export function buildChangelogEmbed({ title, version, notes, author }) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(version ? `${title} (${version})` : title)
    .setDescription(notes.slice(0, DESCRIPTION_MAX_LENGTH))
    .setTimestamp(new Date());

  if (author) {
    embed.setFooter({ text: `Changelog von ${author}` });
  }

  return embed;
}
