import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { canManageServer } from "../../core/permissions.js";
import { setupPanelCommand } from "./commands/setupPanel.js";
import { ensureSetupChannel } from "./services/ensureSetupChannel.js";
import {
  buildSetupPanelPayload,
  postSetupPanel,
  SETUP_CONFIG_MODAL_PREFIX,
  SETUP_CONFIG_PREFIX,
  SETUP_REFRESH_ID,
  SETUP_TOGGLE_PREFIX
} from "./services/panel.js";
import { ensureVerifyDefaults } from "../verify/services/provisioning.js";

function extractSnowflake(raw) {
  const text = String(raw || "").trim();
  if (!text) {
    return "";
  }

  const match = text.match(/(\d{16,20})/);
  return match?.[1] || "";
}

function buildVerifyConfigModal(verifyState) {
  const config = verifyState?.config || {};
  const modal = new ModalBuilder()
    .setCustomId(`${SETUP_CONFIG_MODAL_PREFIX}verify`)
    .setTitle("Verify-Modul konfigurieren");

  const roleInput = new TextInputBuilder()
    .setCustomId("verify_role_id")
    .setLabel("Verify-Rolle (ID oder Erwähnung)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder("Leer lassen = automatisch erstellen");

  if (config.roleId) {
    roleInput.setValue(config.roleId);
  }

  const channelInput = new TextInputBuilder()
    .setCustomId("verify_channel_id")
    .setLabel("Verify-Channel (ID oder Erwähnung)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder("Leer lassen = automatisch erstellen");

  if (config.channelId) {
    channelInput.setValue(config.channelId);
  }

  const rulesInput = new TextInputBuilder()
    .setCustomId("verify_rules_text")
    .setLabel("Regeltext")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setPlaceholder("Leer lassen = Standard-Regeltext")
    .setMaxLength(900);

  if (config.rulesText) {
    rulesInput.setValue(config.rulesText);
  }

  modal.addComponents(
    new ActionRowBuilder().addComponents(roleInput),
    new ActionRowBuilder().addComponents(channelInput),
    new ActionRowBuilder().addComponents(rulesInput)
  );

  return modal;
}

async function handleSetupInteraction({ client, interaction }) {
  if (!interaction.inGuild()) {
    return;
  }

  const isToggleButton = interaction.isButton() && interaction.customId.startsWith(SETUP_TOGGLE_PREFIX);
  const isConfigButton = interaction.isButton() && interaction.customId.startsWith(SETUP_CONFIG_PREFIX);
  const isRefreshButton = interaction.isButton() && interaction.customId === SETUP_REFRESH_ID;
  const isConfigModal = interaction.isModalSubmit() && interaction.customId.startsWith(SETUP_CONFIG_MODAL_PREFIX);

  if (!isToggleButton && !isConfigButton && !isRefreshButton && !isConfigModal) {
    return;
  }

  if (!canManageServer(interaction.member)) {
    await interaction.reply({
      content: "Nur Admins oder Mitglieder mit Server-verwalten dürfen Module verwalten.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const { moduleConfigStore } = client.botContext;
  moduleConfigStore.ensureGuild(interaction.guildId);

  if (isToggleButton) {
    const moduleName = interaction.customId.slice(SETUP_TOGGLE_PREFIX.length);
    const currentState = moduleConfigStore.getModuleState(interaction.guildId, moduleName);

    if (!currentState) {
      await interaction.reply({
        content: `Unbekanntes Modul: ${moduleName}`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const nextEnabled = !currentState.enabled;
    moduleConfigStore.setModuleEnabled(interaction.guildId, moduleName, nextEnabled);

    if (moduleName === "verify" && nextEnabled) {
      await ensureVerifyDefaults(client, interaction.guild);
    }

    await interaction.update(buildSetupPanelPayload(client, interaction.guildId));
    return;
  }

  if (isConfigButton) {
    const moduleName = interaction.customId.slice(SETUP_CONFIG_PREFIX.length);

    if (moduleName !== "verify") {
      await interaction.reply({
        content: `Für ${moduleName} gibt es aktuell keine Detail-Konfiguration.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const verifyState = moduleConfigStore.getModuleState(interaction.guildId, "verify");
    await interaction.showModal(buildVerifyConfigModal(verifyState));
    return;
  }

  if (isRefreshButton) {
    await interaction.update(buildSetupPanelPayload(client, interaction.guildId));
    return;
  }

  if (isConfigModal) {
    const moduleName = interaction.customId.slice(SETUP_CONFIG_MODAL_PREFIX.length);

    if (moduleName !== "verify") {
      await interaction.reply({
        content: `Unbekannte Konfiguration: ${moduleName}`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const roleId = extractSnowflake(interaction.fields.getTextInputValue("verify_role_id"));
    const channelId = extractSnowflake(interaction.fields.getTextInputValue("verify_channel_id"));
    const rulesText = interaction.fields.getTextInputValue("verify_rules_text")?.trim();

    const verifyState = moduleConfigStore.getModuleState(interaction.guildId, "verify");
    moduleConfigStore.setModuleConfig(interaction.guildId, "verify", {
      roleId,
      channelId,
      rulesText,
      panelMessageId: verifyState?.config?.panelMessageId || ""
    });

    if (moduleConfigStore.isModuleEnabled(interaction.guildId, "verify")) {
      await ensureVerifyDefaults(client, interaction.guild);
    }

    await interaction.reply({
      content: [
        "Verify-Konfiguration gespeichert.",
        roleId ? `Rolle: <@&${roleId}>` : "Rolle: automatisch",
        channelId ? `Channel: <#${channelId}>` : "Channel: automatisch",
        rulesText ? "Regeltext: individuell" : "Regeltext: Standard"
      ].join("\n"),
      flags: MessageFlags.Ephemeral
    });
  }
}

async function handleGuildCreate({ client, guild }) {
  const { env, logger, moduleConfigStore } = client.botContext;
  moduleConfigStore.ensureGuild(guild.id);

  if (!env.autoSetupChannelOnGuildJoin) {
    return;
  }

  const { channel, created } = await ensureSetupChannel(guild, env.setupChannelName, logger);

  if (channel && created) {
    await postSetupPanel(channel, client);
    logger.info("Setup-Channel erstellt und Panel gepostet", {
      guildId: guild.id,
      channelId: channel.id
    });

    if (moduleConfigStore.isModuleEnabled(guild.id, "verify")) {
      await ensureVerifyDefaults(client, guild);
    }
  }
}

export const setupModule = {
  name: "setup",
  defaultEnabled: true,
  defaultConfig: {},
  commands: [setupPanelCommand],
  events: {
    guildCreate: [handleGuildCreate],
    interactionCreate: [handleSetupInteraction]
  }
};
