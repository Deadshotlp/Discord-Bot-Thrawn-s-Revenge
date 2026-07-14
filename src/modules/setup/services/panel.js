import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} from "discord.js";
import {
  formatPublishSchedule,
  normalizeWeeklyReportConfig
} from "../../weeklyReport/services/config.js";

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

  if (moduleName === "updates") {
    const config = moduleState?.config || {};
    const repos = Array.isArray(config.repos) ? config.repos : [];
    const changelogRoleIds = Array.isArray(config.changelogRoleIds) ? config.changelogRoleIds : [];
    return [
      activeText,
      `Channel: ${toChannelMention(config.channelId)}`,
      `Repos: ${repos.length}`,
      `Changelog-Rollen: ${changelogRoleIds.length}`
    ].join("\n");
  }

  if (moduleName === "content-creator") {
    const config = moduleState?.config || {};
    const youtubeChannels = Array.isArray(config.youtubeChannels) ? config.youtubeChannels : [];
    const twitchChannels = Array.isArray(config.twitchChannels) ? config.twitchChannels : [];

    return [
      activeText,
      `Notify: ${toChannelMention(config.notifyChannelId)}`,
      `YouTube: ${youtubeChannels.length}`,
      `Twitch: ${twitchChannels.length}`
    ].join("\n");
  }

  if (moduleName === "server-status") {
    const config = moduleState?.config || {};
    return [
      activeText,
      `Server: ${config.serverHost ? `${config.serverHost}:${config.serverPort || 27015}` : "(nicht gesetzt)"}`,
      `Panel-Channel: ${toChannelMention(config.statusChannelId)}`
    ].join("\n");
  }

  if (moduleName === "weekly-report") {
    const config = normalizeWeeklyReportConfig(moduleState?.config);
    return [
      activeText,
      `Channel: ${toChannelMention(config.publishChannelId)}`,
      `Termin: ${formatPublishSchedule(config)}`
    ].join("\n");
  }

  if (moduleName === "meeting") {
    const meetings = Array.isArray(moduleState?.config?.meetings) ? moduleState.config.meetings : [];
    return [
      activeText,
      `Meetings: ${meetings.length}`
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

  const toggleRows = [];
  for (let index = 0; index < managedModules.length; index += 5) {
    const rowModules = managedModules.slice(index, index + 5);
    const row = new ActionRowBuilder();

    for (const moduleDef of rowModules) {
      const moduleState = moduleConfigStore.getModuleState(guildId, moduleDef.name);
      const active = Boolean(moduleState?.enabled);

      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`${SETUP_TOGGLE_PREFIX}${moduleDef.name}`)
          .setLabel(`${toLabel(moduleDef.name)} ${active ? "aus" : "ein"}`)
          .setStyle(active ? ButtonStyle.Danger : ButtonStyle.Success)
      );
    }

    toggleRows.push(row);
  }

  const configurableModules = [
    { name: "verify", label: "Verify konfigurieren" },
    { name: "support", label: "Support konfigurieren" },
    { name: "updates", label: "Updates konfigurieren" },
    { name: "content-creator", label: "Content Creator konfigurieren" },
    { name: "server-status", label: "Server-Status konfigurieren" },
    { name: "weekly-report", label: "Wochenberichte konfigurieren" },
    { name: "meeting", label: "Meetings verwalten" }
  ].filter(({ name }) => managedModules.some((moduleDef) => moduleDef.name === name));

  const configButtons = configurableModules.map(({ name, label }) => (
    new ButtonBuilder()
      .setCustomId(`${SETUP_CONFIG_PREFIX}${name}`)
      .setLabel(label)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!moduleConfigStore.isModuleEnabled(guildId, name))
  ));

  configButtons.push(
    new ButtonBuilder()
      .setCustomId(SETUP_REFRESH_ID)
      .setLabel("Status aktualisieren")
      .setStyle(ButtonStyle.Secondary)
  );

  const configRows = [];
  for (let index = 0; index < configButtons.length; index += 5) {
    configRows.push(new ActionRowBuilder().addComponents(configButtons.slice(index, index + 5)));
  }

  return {
    embeds: [embed],
    components: [...toggleRows, ...configRows]
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
