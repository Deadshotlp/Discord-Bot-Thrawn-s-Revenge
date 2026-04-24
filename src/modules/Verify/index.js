import { MessageFlags } from "discord.js";
import { verifyPanelCommand } from "./commands/verifyPanel.js";
import {
  DEFAULT_VERIFY_RULES_TEXT,
  VERIFY_ACCEPT_BUTTON_ID
} from "./services/panel.js";
import { ensureVerifyDefaults } from "./services/provisioning.js";

async function handleVerifyInteraction({ client, interaction }) {
  if (!interaction.isButton() || interaction.customId !== VERIFY_ACCEPT_BUTTON_ID) {
    return;
  }

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "Verifizierung ist nur auf einem Server möglich.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const verifyState = client.botContext.moduleConfigStore.getModuleState(interaction.guildId, "verify");
  const roleId = verifyState?.config?.roleId || "";

  if (!roleId) {
    await interaction.reply({
      content: "Verify-Rolle ist nicht konfiguriert. Bitte informiere das Team.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const role = interaction.guild.roles.cache.get(roleId)
    || (await interaction.guild.roles.fetch(roleId).catch(() => null));

  if (!role) {
    await interaction.reply({
      content: "Die Verify-Rolle wurde nicht gefunden. Bitte informiere das Team.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (interaction.member.roles.cache.has(role.id)) {
    await interaction.reply({
      content: "Du bist bereits verifiziert.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  try {
    await interaction.member.roles.add(role, "Regeln akzeptiert");
    await interaction.reply({
      content: "Verifizierung erfolgreich. Willkommen!",
      flags: MessageFlags.Ephemeral
    });
  } catch {
    await interaction.reply({
      content: "Verifizierung fehlgeschlagen. Bitte informiere das Team.",
      flags: MessageFlags.Ephemeral
    });
  }
}

async function handleVerifyGuildCreate({ client, guild }) {
  if (!client.botContext.moduleConfigStore.isModuleEnabled(guild.id, "verify")) {
    return;
  }

  await ensureVerifyDefaults(client, guild);
}

async function handleVerifyReady({ client }) {
  for (const guild of client.guilds.cache.values()) {
    if (!client.botContext.moduleConfigStore.isModuleEnabled(guild.id, "verify")) {
      continue;
    }

    await ensureVerifyDefaults(client, guild);
  }
}

export const verifyModule = {
  name: "verify",
  defaultEnabled: false,
  defaultConfig: {
    roleId: "",
    channelId: "",
    panelMessageId: "",
    rulesText: DEFAULT_VERIFY_RULES_TEXT
  },
  commands: [verifyPanelCommand],
  events: {
    interactionCreate: [handleVerifyInteraction],
    guildCreate: [handleVerifyGuildCreate],
    ready: [handleVerifyReady]
  }
};
