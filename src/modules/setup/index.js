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
import { ensureSupportDefaults } from "../support/services/provisioning.js";
import {
  ensureDefaultDepartment,
  ensureValidDefaultDepartmentId,
  extractRoleIds,
  SUPPORT_DEFAULT_DEPARTMENT_ID
} from "../support/services/config.js";
import { ensureVerifyDefaults } from "../verify/services/provisioning.js";
import { VERIFY_RULES_TEXT_MAX_LENGTH } from "../verify/services/panel.js";
import { normalizeContentCreatorConfig } from "../contentCreator/services/config.js";
import { buildContentCreatorSetupModal } from "../contentCreator/services/panel.js";

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
    .setMaxLength(VERIFY_RULES_TEXT_MAX_LENGTH);

  if (config.rulesText) {
    rulesInput.setValue(String(config.rulesText).slice(0, VERIFY_RULES_TEXT_MAX_LENGTH));
  }

  modal.addComponents(
    new ActionRowBuilder().addComponents(roleInput),
    new ActionRowBuilder().addComponents(channelInput),
    new ActionRowBuilder().addComponents(rulesInput)
  );

  return modal;
}

function buildSupportConfigModal(supportState, env) {
  const config = supportState?.config || {};
  const departments = ensureDefaultDepartment(config.departments, env.supportDefaultDepartmentName, []);
  const defaultDepartmentId = ensureValidDefaultDepartmentId(
    departments,
    config.defaultDepartmentId || SUPPORT_DEFAULT_DEPARTMENT_ID
  );
  const defaultDepartment = departments.find((department) => department.id === defaultDepartmentId) || departments[0];

  const modal = new ModalBuilder()
    .setCustomId(`${SETUP_CONFIG_MODAL_PREFIX}support`)
    .setTitle("Support-Modul konfigurieren");

  const waitingChannelInput = new TextInputBuilder()
    .setCustomId("support_waiting_channel_id")
    .setLabel("Support Warteraum (Voice ID)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder("Leer lassen = automatisch erstellen");

  if (config.waitingChannelId) {
    waitingChannelInput.setValue(config.waitingChannelId);
  }

  const managementChannelInput = new TextInputBuilder()
    .setCustomId("support_management_channel_id")
    .setLabel("Support Verwaltung (Text ID)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder("Leer lassen = automatisch erstellen");

  if (config.managementChannelId) {
    managementChannelInput.setValue(config.managementChannelId);
  }

  const talkCategoryInput = new TextInputBuilder()
    .setCustomId("support_talk_category_id")
    .setLabel("Talk Kategorie (ID)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder("Leer lassen = automatisch erstellen");

  if (config.talkCategoryId) {
    talkCategoryInput.setValue(config.talkCategoryId);
  }

  const defaultDepartmentNameInput = new TextInputBuilder()
    .setCustomId("support_default_department_name")
    .setLabel("Default Department Name")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder("Name für Department beim Warteraum")
    .setMaxLength(80);

  if (defaultDepartment?.name) {
    defaultDepartmentNameInput.setValue(defaultDepartment.name.slice(0, 80));
  }

  const defaultDepartmentRolesInput = new TextInputBuilder()
    .setCustomId("support_default_department_roles")
    .setLabel("Default Department Rollen")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setPlaceholder("Mehrere Rollen-IDs oder Erwähnungen")
    .setMaxLength(400);

  if (Array.isArray(defaultDepartment?.roleIds) && defaultDepartment.roleIds.length > 0) {
    defaultDepartmentRolesInput.setValue(defaultDepartment.roleIds.join(", ").slice(0, 400));
  }

  modal.addComponents(
    new ActionRowBuilder().addComponents(waitingChannelInput),
    new ActionRowBuilder().addComponents(managementChannelInput),
    new ActionRowBuilder().addComponents(talkCategoryInput),
    new ActionRowBuilder().addComponents(defaultDepartmentNameInput),
    new ActionRowBuilder().addComponents(defaultDepartmentRolesInput)
  );

  return modal;
}

async function handleSetupInteraction({ client, interaction }) {
  try {
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

    if (nextEnabled) {
      if (moduleName === "verify") {
        await ensureVerifyDefaults(client, interaction.guild);
      }

      if (moduleName === "support") {
        await ensureSupportDefaults(client, interaction.guild);
      }
    }

    await interaction.update(buildSetupPanelPayload(client, interaction.guildId));
      return;
    }

    if (isConfigButton) {
    const moduleName = interaction.customId.slice(SETUP_CONFIG_PREFIX.length);

    if (moduleName === "verify") {
      const verifyState = moduleConfigStore.getModuleState(interaction.guildId, "verify");
      await interaction.showModal(buildVerifyConfigModal(verifyState));
      return;
    }

    if (moduleName === "support") {
      const supportState = moduleConfigStore.getModuleState(interaction.guildId, "support");
      await interaction.showModal(buildSupportConfigModal(supportState, client.botContext.env));
      return;
    }

      if (moduleName === "content-creator") {
        const contentState = moduleConfigStore.getModuleState(interaction.guildId, "content-creator");
        await interaction.showModal(buildContentCreatorSetupModal(normalizeContentCreatorConfig(contentState?.config)));
        return;
      }

    if (moduleName !== "verify") {
      await interaction.reply({
        content: `Für ${moduleName} gibt es aktuell keine Detail-Konfiguration.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    }

    if (isRefreshButton) {
      await interaction.update(buildSetupPanelPayload(client, interaction.guildId));
      return;
    }

    if (isConfigModal) {
    const moduleName = interaction.customId.slice(SETUP_CONFIG_MODAL_PREFIX.length);

    if (moduleName === "verify") {
      const roleId = extractSnowflake(interaction.fields.getTextInputValue("verify_role_id"));
      const channelId = extractSnowflake(interaction.fields.getTextInputValue("verify_channel_id"));
      const rulesText = interaction.fields
        .getTextInputValue("verify_rules_text")
        ?.trim()
        ?.slice(0, VERIFY_RULES_TEXT_MAX_LENGTH);

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
      return;
    }

    if (moduleName === "support") {
      const waitingChannelId = extractSnowflake(interaction.fields.getTextInputValue("support_waiting_channel_id"));
      const managementChannelId = extractSnowflake(interaction.fields.getTextInputValue("support_management_channel_id"));
      const talkCategoryId = extractSnowflake(interaction.fields.getTextInputValue("support_talk_category_id"));
      const defaultDepartmentName = interaction.fields
        .getTextInputValue("support_default_department_name")
        ?.trim()
        ?.slice(0, 80);
      const defaultDepartmentRoleIds = extractRoleIds(
        interaction.fields.getTextInputValue("support_default_department_roles") || ""
      );

      const supportState = moduleConfigStore.getModuleState(interaction.guildId, "support");
      const currentConfig = supportState?.config || {};

      const departments = ensureDefaultDepartment(
        currentConfig.departments,
        defaultDepartmentName || client.botContext.env.supportDefaultDepartmentName,
        defaultDepartmentRoleIds
      );

      const defaultDepartment = departments.find((department) => department.id === SUPPORT_DEFAULT_DEPARTMENT_ID);
      if (defaultDepartment) {
        defaultDepartment.name = defaultDepartmentName || defaultDepartment.name;
        defaultDepartment.roleIds = defaultDepartmentRoleIds;
      }

      const defaultDepartmentId = ensureValidDefaultDepartmentId(
        departments,
        currentConfig.defaultDepartmentId
      );

      moduleConfigStore.setModuleConfig(interaction.guildId, "support", {
        ...currentConfig,
        waitingChannelId,
        managementChannelId,
        talkCategoryId,
        departments,
        defaultDepartmentId,
        transcriptTextChannelId: currentConfig.transcriptTextChannelId || managementChannelId || ""
      });

      if (moduleConfigStore.isModuleEnabled(interaction.guildId, "support")) {
        await ensureSupportDefaults(client, interaction.guild);
      }

      await interaction.reply({
        content: [
          "Support-Konfiguration gespeichert.",
          waitingChannelId ? `Warteraum: <#${waitingChannelId}>` : "Warteraum: automatisch",
          managementChannelId ? `Verwaltung: <#${managementChannelId}>` : "Verwaltung: automatisch",
          talkCategoryId ? `Talk-Kategorie: ${talkCategoryId}` : "Talk-Kategorie: automatisch",
          `Default Department: ${defaultDepartment?.name || defaultDepartmentName || client.botContext.env.supportDefaultDepartmentName}`,
          defaultDepartmentRoleIds.length > 0 ? "Department-Rollen: gesetzt" : "Department-Rollen: keine"
        ].join("\n"),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

      await interaction.reply({
        content: `Unbekannte Konfiguration: ${moduleName}`,
        flags: MessageFlags.Ephemeral
      });
    }
  } catch (error) {
    const apiCode = error?.code;
    if (apiCode === 10062 || apiCode === 40060) {
      return;
    }

    throw error;
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

    if (moduleConfigStore.isModuleEnabled(guild.id, "support")) {
      await ensureSupportDefaults(client, guild);
    }
    return;
  }

  if (moduleConfigStore.isModuleEnabled(guild.id, "support")) {
    await ensureSupportDefaults(client, guild);
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
