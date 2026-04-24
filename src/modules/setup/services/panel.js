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

  if (moduleName !== "verify") {
    return activeText;
  }

  const config = moduleState?.config || {};
  return [
    activeText,
    `Rolle: ${toRoleMention(config.roleId)}`,
    `Channel: ${toChannelMention(config.channelId)}`
  ].join("\n");
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
    .setTitle("Modulverwaltung")
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

  const configRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${SETUP_CONFIG_PREFIX}verify`)
      .setLabel("Verify konfigurieren")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!moduleConfigStore.isModuleEnabled(guildId, "verify")),
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

export async function postSetupPanel(channel, client) {
  const payload = buildSetupPanelPayload(client, channel.guild.id);
  return channel.send(payload);
}
