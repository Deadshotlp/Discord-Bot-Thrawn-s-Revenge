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

const ROMAN_NUMERALS = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
  [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
  [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]
];

export function toRomanNumeral(value) {
  let remaining = value;
  let result = "";

  for (const [amount, symbol] of ROMAN_NUMERALS) {
    while (remaining >= amount) {
      result += symbol;
      remaining -= amount;
    }
  }

  return result || String(value);
}

export function formatChangelogDate(date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${date.getFullYear()}`;
}

const ANSI_RESET = "[0m";
const ANSI_GREEN = "[0;32m";
const ANSI_YELLOW = "[0;33m";
const ANSI_RED = "[0;31m";

function colorizeChangelogLine(line) {
  if (line.startsWith("+")) {
    return `${ANSI_GREEN}${line}${ANSI_RESET}`;
  }

  if (line.startsWith("~")) {
    return `${ANSI_YELLOW}${line}${ANSI_RESET}`;
  }

  if (line.startsWith("-")) {
    return `${ANSI_RED}${line}${ANSI_RESET}`;
  }

  return line;
}

export function colorizeChangelogNotes(notes) {
  return notes
    .split("\n")
    .map((line) => colorizeChangelogLine(line))
    .join("\n");
}

export function buildChangelogEmbed({ category, notes, sequence, date, author, authorAvatarUrl, noteText }) {
  const coloredNotes = colorizeChangelogNotes(notes);
  const descriptionParts = [
    `${formatChangelogDate(date)} — Nr. ${toRomanNumeral(sequence)}`,
    "",
    `\`\`\`ansi\n${coloredNotes}\n\`\`\``
  ];

  if (noteText) {
    descriptionParts.push("", noteText);
  }

  const description = descriptionParts.join("\n").slice(0, DESCRIPTION_MAX_LENGTH);

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle(category)
    .setDescription(description)
    .setTimestamp(date);

  if (author) {
    embed.setFooter({ text: `Erstellt von ${author}`, iconURL: authorAvatarUrl || undefined });
  }

  return embed;
}
