import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} from "discord.js";

export const SETUP_TOGGLE_PREFIX = "setup_toggle_module:";
export const SETUP_CONFIG_PREFIX = "setup_config_module:";
export const SETUP_CONFIG_MODAL_PREFIX = "setup_config_modal:";
export const SETUP_REFRESH_ID = "setup_refresh_modules";
const SETUP_PANEL_TITLE = "Modulverwaltung";

function toLabel(moduleName) {
  return moduleName.charAt(0).toUpperCase() + moduleName.slice(1);
}

function toRoleMention(roleId) {
  return roleId ? `<@&${roleId}>` : "(nicht gesetzt)";
}

function toChannelMention(channelId) {
  return channelId ? `<#${channelId}>` : "(nicht gesetzt)";
}

function getManagedModules(modules) {
  return modules.filter((moduleDef) => moduleDef.name !== "setup");
}

function buildStatusText(moduleName, moduleState) {
  const activeText = moduleState?.enabled ? "Eingeschaltet" : "Ausgeschaltet";

  if (moduleName === "verify") {
    const config = moduleState?.config || {};
    return [
      activeText,
      `Rolle: ${toRoleMention(config.roleId)}`,
      `Channel: ${toChannelMention(config.channelId)}`
    ].join("\n");
  }

  if (moduleName === "support") {
    const config = moduleState?.config || {};
    const departments = Array.isArray(config.departments) ? config.departments : [];
    return [
      activeText,
      `Warteraum: ${toChannelMention(config.waitingChannelId)}`,
      `Verwaltung: ${toChannelMention(config.managementChannelId)}`,
      `Departments: ${departments.length}`
    ].join("\n");
  }

  if (moduleName !== "verify") {
    return activeText;
  }

  return activeText;
}

export function buildSetupPanelPayload(client, guildId) {
  const { modules, moduleConfigStore } = client.botContext;
  const managedModules = getManagedModules(modules);

  const fields = managedModules.map((moduleDef) => {
    const moduleState = moduleConfigStore.getModuleState(guildId, moduleDef.name);
    return {
      name: toLabel(moduleDef.name),
      value: buildStatusText(moduleDef.name, moduleState),
      inline: true
    };
  });

  const embed = new EmbedBuilder()
    .setColor(0x1f6feb)
    .setTitle(SETUP_PANEL_TITLE)
    .setDescription(
      [
        "Jedes Modul kann individuell ein- oder ausgeschaltet werden.",
        "Wenn ein Modul aktiviert wird, kannst du es konfigurieren.",
        "Fehlende Channel/Rollen werden mit Standardwerten automatisch erstellt."
      ].join("\n")
    )
    .addFields(fields)
    .setFooter({ text: "Basis-Modul setup bleibt immer bedienbar." });

  const toggleRow = new ActionRowBuilder();
  for (const moduleDef of managedModules.slice(0, 5)) {
    const moduleState = moduleConfigStore.getModuleState(guildId, moduleDef.name);
    const active = Boolean(moduleState?.enabled);

    toggleRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`${SETUP_TOGGLE_PREFIX}${moduleDef.name}`)
        .setLabel(`${toLabel(moduleDef.name)} ${active ? "aus" : "ein"}`)
        .setStyle(active ? ButtonStyle.Danger : ButtonStyle.Success)
    );
  }

  const configRow = new ActionRowBuilder();
  configRow.addComponents(
    new ButtonBuilder()
      .setCustomId(`${SETUP_CONFIG_PREFIX}verify`)
      .setLabel("Verify konfigurieren")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!moduleConfigStore.isModuleEnabled(guildId, "verify"))
  );

  if (managedModules.some((moduleDef) => moduleDef.name === "support")) {
    configRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`${SETUP_CONFIG_PREFIX}support`)
        .setLabel("Support konfigurieren")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!moduleConfigStore.isModuleEnabled(guildId, "support"))
    );
  }

  configRow.addComponents(
    new ButtonBuilder()
      .setCustomId(SETUP_REFRESH_ID)
      .setLabel("Status aktualisieren")
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [toggleRow, configRow]
  };
}

function isSetupPanelMessage(message, botUserId) {
  if (!message || message.author?.id !== botUserId) {
    return false;
  }

  const title = message.embeds?.[0]?.title || "";
  if (title !== SETUP_PANEL_TITLE) {
    return false;
  }

  const componentIds = (message.components || [])
    .flatMap((row) => row.components || [])
    .map((component) => component.customId)
    .filter(Boolean);

  return componentIds.includes(SETUP_REFRESH_ID)
    || componentIds.some((customId) => customId.startsWith(SETUP_TOGGLE_PREFIX));
}

export async function postSetupPanel(channel, client) {
  const payload = buildSetupPanelPayload(client, channel.guild.id);

  const recentMessages = await channel.messages.fetch({ limit: 30 }).catch(() => null);
  const existingPanel = recentMessages?.find((message) => isSetupPanelMessage(message, client.user?.id));

  if (existingPanel) {
    await existingPanel.edit(payload);
    return existingPanel;
  }

  return channel.send(payload);
}
