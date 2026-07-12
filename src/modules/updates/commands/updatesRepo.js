import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { canManageServer } from "../../../core/permissions.js";
import { fetchLatestUpdate, fetchRepoInfo, parseRepoSlug } from "../services/github.js";

function getRepos(moduleConfigStore, guildId) {
  const state = moduleConfigStore.getModuleState(guildId, "updates");
  return Array.isArray(state?.config?.repos) ? state.config.repos : [];
}

function findRepoIndex(repos, owner, repo) {
  return repos.findIndex(
    (entry) => entry.owner.toLowerCase() === owner.toLowerCase() && entry.repo.toLowerCase() === repo.toLowerCase()
  );
}

async function handleAdd({ client, interaction }) {
  const rawSlug = interaction.options.getString("repo", true);
  const label = interaction.options.getString("label")?.trim().slice(0, 80) || "";
  const slug = parseRepoSlug(rawSlug);

  if (!slug) {
    await interaction.reply({
      content: "Bitte gib das Repo im Format `owner/repo` an, z.B. `torvalds/linux`.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const { moduleConfigStore, env } = client.botContext;
  const repos = getRepos(moduleConfigStore, interaction.guildId);

  if (findRepoIndex(repos, slug.owner, slug.repo) !== -1) {
    await interaction.reply({
      content: `\`${slug.owner}/${slug.repo}\` wird bereits beobachtet.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const repoInfo = await fetchRepoInfo(slug.owner, slug.repo, env.githubToken).catch(() => null);
  if (!repoInfo) {
    await interaction.editReply({
      content: `Repo \`${slug.owner}/${slug.repo}\` wurde auf GitHub nicht gefunden.`
    });
    return;
  }

  const baseline = await fetchLatestUpdate(slug.owner, slug.repo, env.githubToken).catch(() => null);

  const state = moduleConfigStore.getModuleState(interaction.guildId, "updates");
  const currentRepos = getRepos(moduleConfigStore, interaction.guildId);
  currentRepos.push({
    owner: slug.owner,
    repo: slug.repo,
    label,
    lastSeenId: baseline?.id || ""
  });

  moduleConfigStore.setModuleConfig(interaction.guildId, "updates", {
    ...(state?.config || {}),
    repos: currentRepos
  });

  await interaction.editReply({
    content: `\`${slug.owner}/${slug.repo}\` wird jetzt beobachtet. Nur zukünftige Updates werden gepostet.`
  });
}

async function handleRemove({ client, interaction }) {
  const rawSlug = interaction.options.getString("repo", true);
  const slug = parseRepoSlug(rawSlug);
  const { moduleConfigStore } = client.botContext;
  const repos = getRepos(moduleConfigStore, interaction.guildId);

  const index = slug
    ? findRepoIndex(repos, slug.owner, slug.repo)
    : repos.findIndex((entry) => `${entry.owner}/${entry.repo}` === rawSlug);

  if (index === -1) {
    await interaction.reply({
      content: `\`${rawSlug}\` wird aktuell nicht beobachtet.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const [removed] = repos.splice(index, 1);
  const state = moduleConfigStore.getModuleState(interaction.guildId, "updates");
  moduleConfigStore.setModuleConfig(interaction.guildId, "updates", {
    ...(state?.config || {}),
    repos
  });

  await interaction.reply({
    content: `\`${removed.owner}/${removed.repo}\` wurde entfernt.`,
    flags: MessageFlags.Ephemeral
  });
}

async function handleList({ client, interaction }) {
  const { moduleConfigStore } = client.botContext;
  const repos = getRepos(moduleConfigStore, interaction.guildId);

  if (repos.length === 0) {
    await interaction.reply({
      content: "Aktuell wird kein Repo beobachtet. Füge eins mit `/updates-repo add` hinzu.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const lines = repos.map((entry) => {
    const label = entry.label ? ` (${entry.label})` : "";
    return `• \`${entry.owner}/${entry.repo}\`${label}`;
  });

  await interaction.reply({
    content: [`Beobachtete Repos (${repos.length}):`, ...lines].join("\n"),
    flags: MessageFlags.Ephemeral
  });
}

export const updatesRepoCommand = {
  data: new SlashCommandBuilder()
    .setName("updates-repo")
    .setDescription("Verwaltet die beobachteten GitHub-Repos für automatische Updates.")
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Fügt ein Repo zur Update-Liste hinzu.")
        .addStringOption((option) =>
          option.setName("repo").setDescription("owner/repo, z.B. torvalds/linux").setRequired(true)
        )
        .addStringOption((option) =>
          option.setName("label").setDescription("Anzeigename für die Update-Posts (optional)").setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Entfernt ein Repo von der Update-Liste.")
        .addStringOption((option) =>
          option
            .setName("repo")
            .setDescription("Repo aus der beobachteten Liste")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((sub) => sub.setName("list").setDescription("Zeigt alle beobachteten Repos.")),

  async autocomplete({ client, interaction }) {
    if (!interaction.inGuild()) {
      await interaction.respond([]);
      return;
    }

    const { moduleConfigStore } = client.botContext;
    const repos = getRepos(moduleConfigStore, interaction.guildId);
    const focused = interaction.options.getFocused().toLowerCase();

    const choices = repos
      .map((entry) => `${entry.owner}/${entry.repo}`)
      .filter((slug) => slug.toLowerCase().includes(focused))
      .slice(0, 25)
      .map((slug) => ({ name: slug, value: slug }));

    await interaction.respond(choices);
  },

  async execute({ client, interaction }) {
    if (!canManageServer(interaction.member)) {
      await interaction.reply({
        content: "Diesen Befehl dürfen nur Admins oder Mitglieder mit Server-verwalten nutzen.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "add") {
      await handleAdd({ client, interaction });
      return;
    }

    if (subcommand === "remove") {
      await handleRemove({ client, interaction });
      return;
    }

    await handleList({ client, interaction });
  }
};
