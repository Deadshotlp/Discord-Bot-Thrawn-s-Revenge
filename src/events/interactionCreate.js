import { EmbedBuilder, MessageFlags } from "discord.js";
import { commandMap } from "../commands/index.js";
import {
  formatDepartmentList,
  getDepartmentsFromSettings
} from "../features/departments/service.js";
import {
  applyVerifiedVisibilityToCategories,
  ensureOnboardingChannels,
  handleVerificationButton
} from "../features/onboarding/service.js";
import { provisionAdminCategoryChannels } from "../features/setup/adminCategoryProvisioning.js";
import {
  ensureTicketPanelPosted,
  handleTicketComponent,
  handleTicketModal,
  isTicketComponentInteraction,
  isTicketModalInteraction
} from "../features/tickets/service.js";
import { canManageServer } from "../utils/permissions.js";

const SETTING_MAP = {
  setup_channel_admin_category: { field: "admin_category_id", mentionPrefix: "#" },
  setup_channel_welcome: { field: "welcome_channel_id", mentionPrefix: "#" },
  setup_channel_ticket_panel: { field: "ticket_panel_channel_id", mentionPrefix: "#" },
  setup_channel_support_waiting: { field: "support_waiting_voice_channel_id", mentionPrefix: "#" },
  setup_role_verified: { field: "verified_role_id", mentionPrefix: "@&" },
  setup_role_team_standard: { field: "standard_team_role_id", mentionPrefix: "@&" }
};

function formatMention(mentionPrefix, id) {
  if (!id) {
    return "Nicht gesetzt";
  }
  return `<${mentionPrefix}${id}>`;
}

function createSummaryEmbed(settings, guildName) {
  const departmentText = formatDepartmentList(getDepartmentsFromSettings(settings));
  const clippedDepartmentText = departmentText.length > 1024
    ? `${departmentText.slice(0, 1000)}\n...`
    : departmentText;

  return new EmbedBuilder()
    .setColor(0x003366)
    .setTitle(`Setup-Status: ${guildName}`)
    .addFields(
      {
        name: "Admin-Log-Kategorie",
        value: formatMention("#", settings?.admin_category_id),
        inline: true
      },
      {
        name: "Willkommens-Channel",
        value: formatMention("#", settings?.welcome_channel_id),
        inline: true
      },
      {
        name: "Regeln-Channel",
        value: formatMention("#", settings?.rules_channel_id),
        inline: true
      },
      {
        name: "Log-Channel",
        value: formatMention("#", settings?.log_channel_id),
        inline: true
      },
      {
        name: "Log Member",
        value: formatMention("#", settings?.log_member_channel_id),
        inline: true
      },
      {
        name: "Log Nachrichten",
        value: formatMention("#", settings?.log_message_channel_id),
        inline: true
      },
      {
        name: "Log Voice",
        value: formatMention("#", settings?.log_voice_channel_id),
        inline: true
      },
      {
        name: "Bot Ping-Channel",
        value: formatMention("#", settings?.bot_ping_channel_id),
        inline: true
      },
      {
        name: "Ticket-Panel-Channel",
        value: formatMention("#", settings?.ticket_panel_channel_id),
        inline: true
      },
      {
        name: "Support-Warteraum",
        value: formatMention("#", settings?.support_waiting_voice_channel_id),
        inline: true
      },
      {
        name: "Verifiziert-Rolle",
        value: formatMention("@&", settings?.verified_role_id),
        inline: true
      },
      {
        name: "Standard-Teamrolle",
        value: formatMention("@&", settings?.standard_team_role_id),
        inline: true
      },
      {
        name: "Departments",
        value: clippedDepartmentText
      }
    )
    .setTimestamp(new Date());
}

function isSetupInteraction(interaction) {
  if (!interaction.customId) {
    return false;
  }

  return interaction.customId.startsWith("setup_");
}

async function safeInteractionResponse(interaction, payload, logger, context) {
  try {
    if (interaction.deferred) {
      await interaction.editReply(payload);
      return;
    }

    if (interaction.replied) {
      await interaction.followUp(payload);
      return;
    }

    await interaction.reply(payload);
  } catch (error) {
    logger.warn("Interaction-Antwort konnte nicht gesendet werden.", {
      guildId: interaction.guildId,
      context,
      error: String(error)
    });
  }
}

async function applyStoredSetupConfiguration(interaction, guildSettingsRepository, logger) {
  let settings = guildSettingsRepository.getByGuildId(interaction.guildId) || {};

  const resultLines = [];
  const warningLines = [];

  if (settings.admin_category_id) {
    try {
      settings = await provisionAdminCategoryChannels(interaction.guild, settings.admin_category_id, guildSettingsRepository);
      resultLines.push("Log-Kategorie angewendet: Log- und Ping-Kanaele sind bereit.");
    } catch (error) {
      warningLines.push(`Log-Kategorie konnte nicht angewendet werden: ${String(error)}`);
    }
  } else {
    warningLines.push("Log-Kategorie nicht gesetzt.");
  }

  try {
    settings = await ensureOnboardingChannels(interaction.guild, guildSettingsRepository, logger);
    resultLines.push("Willkommen- und Regeln-Setup wurde abgeglichen.");
  } catch (error) {
    warningLines.push(`Onboarding konnte nicht vollstaendig angewendet werden: ${String(error)}`);
  }

  if (settings.verified_role_id) {
    try {
      const visibilityResult = await applyVerifiedVisibilityToCategories(interaction.guild, settings, logger);
      resultLines.push(`Kategorie-Sichtbarkeit aktualisiert: ${visibilityResult.updated}`);
      if (visibilityResult.skipped > 0) {
        warningLines.push(`Kategorien ohne ausreichende Rechte uebersprungen: ${visibilityResult.skipped}`);
      }
    } catch (error) {
      warningLines.push(`Verifiziert-Sichtbarkeit konnte nicht angewendet werden: ${String(error)}`);
    }
  } else {
    warningLines.push("Verifiziert-Rolle nicht gesetzt.");
  }

  if (!settings.standard_team_role_id) {
    warningLines.push("Standard-Teamrolle nicht gesetzt. Ohne diese Rolle kann niemand Tickets schliessen oder eskalieren.");
  }

  if (settings.ticket_panel_channel_id) {
    const departments = getDepartmentsFromSettings(settings);
    if (departments.length === 0) {
      warningLines.push("Keine Departments konfiguriert. Nutze /department create und /department role-add.");
    }

    try {
      await ensureTicketPanelPosted(interaction.guild, settings.ticket_panel_channel_id, guildSettingsRepository, logger);
      resultLines.push("Ticket-Panel wurde gepostet oder aktualisiert.");
    } catch (error) {
      warningLines.push(`Ticket-Panel konnte nicht gepostet werden: ${String(error)}`);
    }
  } else {
    warningLines.push("Ticket-Panel-Channel nicht gesetzt.");
  }

  const messageParts = ["Konfiguration angewendet."];

  if (resultLines.length > 0) {
    messageParts.push("", "Erfolgreich:", ...resultLines.map((line) => `- ${line}`));
  }

  if (warningLines.length > 0) {
    messageParts.push("", "Hinweise:", ...warningLines.map((line) => `- ${line}`));
  }

  return messageParts.join("\n");
}

export async function handleInteractionCreate(interaction) {
  const { logger, guildSettingsRepository } = interaction.client.botContext;

  if (interaction.isChatInputCommand()) {
    const command = commandMap.get(interaction.commandName);
    if (!command) {
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      logger.error("Fehler bei Slash-Command.", { command: interaction.commandName, error: String(error) });

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "Beim Ausfuehren des Befehls ist ein Fehler aufgetreten.",
          flags: MessageFlags.Ephemeral
        });
      }
    }

    return;
  }

  if (!interaction.inGuild()) {
    return;
  }

  if (interaction.isButton() && interaction.customId === "verify_accept_rules") {
    await handleVerificationButton(interaction, guildSettingsRepository);
    return;
  }

  if (interaction.isModalSubmit() && isTicketModalInteraction(interaction)) {
    try {
      await handleTicketModal(interaction, guildSettingsRepository, logger);
    } catch (error) {
      logger.warn("Ticket-Modal konnte nicht verarbeitet werden.", {
        guildId: interaction.guildId,
        error: String(error)
      });

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "Ticket konnte nicht erstellt werden. Bitte pruefe Bot-Rechte und Kanalzugriff.",
          flags: MessageFlags.Ephemeral
        });
      }
    }

    return;
  }

  if (isTicketComponentInteraction(interaction)) {
    try {
      await handleTicketComponent(interaction, guildSettingsRepository, logger);
    } catch (error) {
      logger.warn("Ticket-Interaktion konnte nicht verarbeitet werden.", {
        guildId: interaction.guildId,
        error: String(error)
      });

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "Ticket-Aktion fehlgeschlagen. Bitte pruefe Bot-Rechte und Kanalzugriff.",
          flags: MessageFlags.Ephemeral
        });
      }
    }

    return;
  }

  if (!isSetupInteraction(interaction)) {
    return;
  }

  if (!canManageServer(interaction.member)) {
    await interaction.reply({
      content: "Du hast keine Berechtigung fuer das Bot-Setup.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  guildSettingsRepository.ensureGuild(interaction.guildId);

  if (interaction.isButton() && interaction.customId === "setup_apply_configuration") {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
    }

    try {
      const responseText = await applyStoredSetupConfiguration(interaction, guildSettingsRepository, logger);
      await safeInteractionResponse(interaction, {
        content: responseText,
        flags: MessageFlags.Ephemeral
      }, logger, "setup-apply-success");
    } catch (error) {
      logger.warn("Konfiguration konnte nicht angewendet werden.", {
        guildId: interaction.guildId,
        error: String(error)
      });

      await safeInteractionResponse(interaction, {
        content: "Konfiguration konnte nicht angewendet werden. Bitte pruefe Bot-Rechte und Kanalzugriffe.",
        flags: MessageFlags.Ephemeral
      }, logger, "setup-apply-failed");
    }

    return;
  }

  if (interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu()) {
    const config = SETTING_MAP[interaction.customId];
    if (!config) {
      return;
    }

    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
    }

    try {
      const selectedId = interaction.values?.[0];
      guildSettingsRepository.setField(interaction.guildId, config.field, selectedId);
      const replyContent = [
        `Gespeichert: ${config.field} = ${formatMention(config.mentionPrefix, selectedId)}`,
        "Die Aenderung wird mit Konfiguration anwenden uebernommen."
      ].join("\n");

      await safeInteractionResponse(interaction, {
        content: replyContent,
        flags: MessageFlags.Ephemeral
      }, logger, "setup-save-success");
    } catch (error) {
      logger.warn("Setup-Interaktion fehlgeschlagen.", {
        guildId: interaction.guildId,
        customId: interaction.customId,
        error: String(error)
      });

      await safeInteractionResponse(interaction, {
        content: "Setup konnte nicht gespeichert werden. Bitte pruefe Bot-Rechte und Kanalzugriffe.",
        flags: MessageFlags.Ephemeral
      }, logger, "setup-save-failed");
    }

    return;
  }

  if (interaction.isButton() && interaction.customId === "setup_show_summary") {
    const settings = guildSettingsRepository.getByGuildId(interaction.guildId);
    const embed = createSummaryEmbed(settings, interaction.guild.name);

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    });
  }
}
