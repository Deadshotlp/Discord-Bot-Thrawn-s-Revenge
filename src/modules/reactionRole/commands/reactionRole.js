import {
  ActionRowBuilder,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { canManageServer } from "../../../core/permissions.js";
import {
  buildBindingFromReaction,
  findReactionRoleBindingIndex,
  formatBindingEmoji,
  normalizeReactionRoleBindings,
  parseEmojiInput
} from "../services/config.js";

export const REACTION_ROLE_PANEL_MODAL_PREFIX = "reaction_role_panel_modal:";
export const REACTION_ROLE_PANEL_TITLE_INPUT_ID = "reaction_role_panel_title";
export const REACTION_ROLE_PANEL_TEXT_INPUT_ID = "reaction_role_panel_text";
export const REACTION_ROLE_PANEL_MAPPINGS_INPUT_ID = "reaction_role_panel_mappings";

function toSnowflake(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  const matches = text.match(/\d{16,20}/g) || [];
  return matches.at(-1) || "";
}

function parseMessageTarget(value) {
  const text = String(value || "").trim();
  const matches = text.match(/\d{16,20}/g) || [];

  if (matches.length === 0) {
    return { channelId: "", messageId: "" };
  }

  if (matches.length >= 2) {
    return {
      channelId: matches.at(-2) || "",
      messageId: matches.at(-1) || ""
    };
  }

  return {
    channelId: "",
    messageId: matches[0]
  };
}

function isSupportedReactionChannel(channel) {
  if (!channel) {
    return false;
  }

  return [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type);
}

function buildListResponse(bindings) {
  const maxMessageLength = 1900;
  const maxEntries = 25;
  const normalized = normalizeReactionRoleBindings(bindings);

  if (normalized.length === 0) {
    return "Keine Reaction-Roles konfiguriert.";
  }

  const lines = normalized
    .slice(0, maxEntries)
    .map((binding) => [
      `Nachricht: <#${binding.channelId}> / ${binding.messageId}`,
      `Emoji: ${formatBindingEmoji(binding)}`,
      `Rolle: <@&${binding.roleId}>`
    ].join("\n"));

  const output = [];
  let length = 0;

  for (const line of lines) {
    const nextLength = length + line.length + (output.length > 0 ? 2 : 0);
    if (nextLength > maxMessageLength) {
      break;
    }

    output.push(line);
    length = nextLength;
  }

  const hasMore = normalized.length > output.length;

  return [
    ...output,
    hasMore ? "... weitere Einträge vorhanden" : ""
  ].filter(Boolean).join("\n\n");
}

function buildReactionRolePanelModal(channelId) {
  const modal = new ModalBuilder()
    .setCustomId(`${REACTION_ROLE_PANEL_MODAL_PREFIX}${channelId}`)
    .setTitle("Reaction-Role Panel erstellen");

  const titleInput = new TextInputBuilder()
    .setCustomId(REACTION_ROLE_PANEL_TITLE_INPUT_ID)
    .setLabel("Titel (optional)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(120)
    .setPlaceholder("z.B. Rollen-Auswahl");

  const textInput = new TextInputBuilder()
    .setCustomId(REACTION_ROLE_PANEL_TEXT_INPUT_ID)
    .setLabel("Panel-Text")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1500)
    .setPlaceholder("Schreibe hier den Text für dein Reaction-Role Panel.");

  const mappingsInput = new TextInputBuilder()
    .setCustomId(REACTION_ROLE_PANEL_MAPPINGS_INPUT_ID)
    .setLabel("Emoji = Rolle (eine Zeile pro Mapping)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(2000)
    .setPlaceholder("✅ = @Member\n❌ = @Gast\n<:jedi:123456789012345678> = @Jedi");

  modal.addComponents(
    new ActionRowBuilder().addComponents(titleInput),
    new ActionRowBuilder().addComponents(textInput),
    new ActionRowBuilder().addComponents(mappingsInput)
  );

  return modal;
}

export const reactionRoleCommand = {
  data: new SlashCommandBuilder()
    .setName("reaction-role")
    .setDescription("Verwaltet Reaction-Roles und erstellt Panel-Nachrichten.")
    .addSubcommand((subcommand) => subcommand
      .setName("panel")
      .setDescription("Öffnet ein Fenster für Text + Emoji/Rollen-Mappings.")
      .addChannelOption((option) => option
        .setName("kanal")
        .setDescription("Textkanal für die Panel-Nachricht")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((subcommand) => subcommand
      .setName("add")
      .setDescription("Fügt eine Reaction-Role Zuordnung hinzu oder aktualisiert sie.")
      .addChannelOption((option) => option
        .setName("kanal")
        .setDescription("Textkanal der Zielnachricht")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addStringOption((option) => option
        .setName("nachricht")
        .setDescription("ID oder Link der Nachricht")
        .setRequired(true))
      .addStringOption((option) => option
        .setName("emoji")
        .setDescription("Emoji (z.B. ✅ oder <:name:id>)")
        .setRequired(true))
      .addRoleOption((option) => option
        .setName("rolle")
        .setDescription("Rolle, die vergeben werden soll")
        .setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("remove")
      .setDescription("Entfernt eine Reaction-Role Zuordnung.")
      .addStringOption((option) => option
        .setName("nachricht")
        .setDescription("ID oder Link der Nachricht")
        .setRequired(true))
      .addStringOption((option) => option
        .setName("emoji")
        .setDescription("Emoji der Zuordnung")
        .setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("list")
      .setDescription("Listet alle Reaction-Role Zuordnungen auf.")),

  async execute({ client, interaction }) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "Dieser Befehl funktioniert nur auf einem Server.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (!canManageServer(interaction.member)) {
      await interaction.reply({
        content: "Nur Admins oder Mitglieder mit Server-verwalten dürfen Reaction-Roles verwalten.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const { moduleConfigStore } = client.botContext;
    const moduleState = moduleConfigStore.getModuleState(interaction.guildId, "reaction-role");

    if (!moduleState) {
      await interaction.reply({
        content: "Reaction-Role Modul wurde nicht gefunden.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    const bindings = normalizeReactionRoleBindings(moduleState.config?.bindings);

    if (subcommand === "add" || subcommand === "remove") {
      await interaction.reply({
        content: "Dieser Modus wurde auf Button-Panel umgestellt. Nutze bitte /reaction-role panel, um Rollen ueber Buttons anzubieten.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (subcommand === "panel") {
      const channel = interaction.options.getChannel("kanal", true);

      if (!isSupportedReactionChannel(channel)) {
        await interaction.reply({
          content: "Bitte einen normalen Text- oder Ankündigungskanal auswählen.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      await interaction.showModal(buildReactionRolePanelModal(channel.id));
      return;
    }

    await interaction.deferReply({
      flags: MessageFlags.Ephemeral
    });

    try {
      if (subcommand === "list") {
        await interaction.editReply({
          content: buildListResponse(bindings)
        });
        return;
      }

      if (subcommand === "add") {
        const selectedChannel = interaction.options.getChannel("kanal", true);
        const rawMessageInput = interaction.options.getString("nachricht", true);
        const target = parseMessageTarget(rawMessageInput);
        const messageId = target.messageId;
        const emojiInput = interaction.options.getString("emoji", true).trim();
        const role = interaction.options.getRole("rolle", true);

        let channel = selectedChannel;

        if (target.channelId && interaction.guild) {
          const linkedChannel = interaction.guild.channels.cache.get(target.channelId)
            || (await interaction.guild.channels.fetch(target.channelId).catch(() => null));

          if (linkedChannel && isSupportedReactionChannel(linkedChannel)) {
            channel = linkedChannel;
          }
        }

        if (!isSupportedReactionChannel(channel)) {
          await interaction.editReply({
            content: "Bitte einen normalen Text- oder Ankündigungskanal auswählen."
          });
          return;
        }

        if (!messageId) {
          await interaction.editReply({
            content: "Ungültige Nachrichten-ID oder Link."
          });
          return;
        }

        const message = await channel.messages.fetch(messageId).catch(() => null);
        if (!message) {
          await interaction.editReply({
            content: "Nachricht wurde nicht gefunden oder ist nicht lesbar."
          });
          return;
        }

        const reaction = await message.react(emojiInput).catch(() => null);
        if (!reaction) {
          await interaction.editReply({
            content: "Emoji konnte nicht an die Nachricht angehängt werden. Prüfe Emoji und Bot-Rechte."
          });
          return;
        }

        const binding = buildBindingFromReaction({
          channelId: channel.id,
          messageId: message.id,
          roleId: role.id,
          reaction
        });

        if (!binding) {
          await interaction.editReply({
            content: "Zuordnung konnte nicht erstellt werden."
          });
          return;
        }

        const existingIndex = findReactionRoleBindingIndex(bindings, {
          messageId: binding.messageId,
          emojiId: binding.emojiId,
          emojiName: binding.emojiName
        });

        const nextBindings = [...bindings];
        if (existingIndex >= 0) {
          nextBindings[existingIndex] = binding;
        } else {
          nextBindings.push(binding);
        }

        moduleConfigStore.setModuleConfig(interaction.guildId, "reaction-role", {
          bindings: nextBindings
        });

        await interaction.editReply({
          content: [
            "Reaction-Role gespeichert.",
            `Nachricht: <#${binding.channelId}> / ${binding.messageId}`,
            `Emoji: ${formatBindingEmoji(binding)}`,
            `Rolle: <@&${binding.roleId}>`
          ].join("\n")
        });
        return;
      }

      if (subcommand === "remove") {
        const rawMessageInput = interaction.options.getString("nachricht", true);
        const messageId = parseMessageTarget(rawMessageInput).messageId;
        const emojiInput = interaction.options.getString("emoji", true).trim();
        const emoji = parseEmojiInput(emojiInput);

        if (!messageId) {
          await interaction.editReply({
            content: "Ungültige Nachrichten-ID oder Link."
          });
          return;
        }

        if (!emoji) {
          await interaction.editReply({
            content: "Ungültiges Emoji."
          });
          return;
        }

        const removeIndex = findReactionRoleBindingIndex(bindings, {
          messageId,
          emojiId: emoji.emojiId,
          emojiName: emoji.emojiName
        });

        if (removeIndex < 0) {
          await interaction.editReply({
            content: "Keine passende Reaction-Role Zuordnung gefunden."
          });
          return;
        }

        const nextBindings = [...bindings];
        const [removedBinding] = nextBindings.splice(removeIndex, 1);

        moduleConfigStore.setModuleConfig(interaction.guildId, "reaction-role", {
          bindings: nextBindings
        });

        await interaction.editReply({
          content: [
            "Reaction-Role entfernt.",
            `Nachricht: <#${removedBinding.channelId}> / ${removedBinding.messageId}`,
            `Emoji: ${formatBindingEmoji(removedBinding)}`,
            `Rolle: <@&${removedBinding.roleId}>`
          ].join("\n")
        });
        return;
      }

      await interaction.editReply({
        content: "Unbekannter Subcommand."
      });
    } catch {
      await interaction.editReply({
        content: "Beim Ausführen des Befehls ist ein Fehler aufgetreten."
      }).catch(() => null);
    }
  }
};
