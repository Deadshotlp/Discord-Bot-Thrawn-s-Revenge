import { supportDepartmentCommand } from "./commands/supportDepartment.js";
import { supportDepartmentUiCommand } from "./commands/supportDepartmentUi.js";
import { supportTicketPanelCommand } from "./commands/supportTicketPanel.js";
import { ensureSupportDefaults } from "./services/provisioning.js";
import { scheduleClosedTicketDeletionsForGuild } from "./services/closedTicketCleanup.js";
import {
  SUPPORT_CLAIM_PREFIX,
  SUPPORT_CLOSE_PREFIX,
  SUPPORT_ESCALATE_PREFIX,
  SUPPORT_ESCALATE_SELECT_PREFIX,
  SUPPORT_TRANSCRIPT_PREFIX
} from "./services/panel.js";
import {
  SUPPORT_TICKET_CLOSE_PREFIX,
  SUPPORT_TICKET_DEPARTMENT_SELECT_ID,
  SUPPORT_TICKET_ESCALATE_PREFIX,
  SUPPORT_TICKET_ESCALATE_SELECT_PREFIX,
  SUPPORT_TICKET_OPEN_BUTTON_ID,
  SUPPORT_TICKET_OPEN_MODAL_PREFIX
} from "./services/ticketPanel.js";
import { handleSupportVoiceStateUpdate } from "./handlers/voiceCaseHandlers.js";
import {
  handleClaimInteraction,
  handleCloseInteraction,
  handleEscalateInteraction,
  handleEscalationSelectInteraction,
  handleTranscriptInteraction
} from "./handlers/caseInteractionHandlers.js";
import {
  handleTicketCloseInteraction,
  handleTicketDepartmentSelectInteraction,
  handleTicketEscalateInteraction,
  handleTicketEscalationSelectInteraction,
  handleTicketOpenButtonInteraction,
  handleTicketOpenModalInteraction
} from "./handlers/ticketInteractionHandlers.js";
import { handleDepartmentUiInteraction } from "./handlers/departmentUiHandlers.js";

async function handleSupportInteraction({ client, interaction }) {
  if (!interaction.inGuild()) {
    return;
  }

  const handledByDepartmentUi = await handleDepartmentUiInteraction({ client, interaction });
  if (handledByDepartmentUi) {
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith(SUPPORT_TICKET_OPEN_MODAL_PREFIX)) {
    await handleTicketOpenModalInteraction({ client, interaction });
    return;
  }

  if (interaction.isButton()) {
    if (interaction.customId === SUPPORT_TICKET_OPEN_BUTTON_ID) {
      await handleTicketOpenButtonInteraction({ client, interaction });
      return;
    }

    if (interaction.customId.startsWith(SUPPORT_TICKET_ESCALATE_PREFIX)) {
      const ticketId = interaction.customId.slice(SUPPORT_TICKET_ESCALATE_PREFIX.length);
      await handleTicketEscalateInteraction({ client, interaction, ticketId });
      return;
    }

    if (interaction.customId.startsWith(SUPPORT_TICKET_CLOSE_PREFIX)) {
      const ticketId = interaction.customId.slice(SUPPORT_TICKET_CLOSE_PREFIX.length);
      await handleTicketCloseInteraction({ client, interaction, ticketId });
      return;
    }

    if (interaction.customId.startsWith(SUPPORT_CLAIM_PREFIX)) {
      const caseId = interaction.customId.slice(SUPPORT_CLAIM_PREFIX.length);
      await handleClaimInteraction({ client, interaction, caseId });
      return;
    }

    if (interaction.customId.startsWith(SUPPORT_ESCALATE_PREFIX)) {
      const caseId = interaction.customId.slice(SUPPORT_ESCALATE_PREFIX.length);
      await handleEscalateInteraction({ client, interaction, caseId });
      return;
    }

    if (interaction.customId.startsWith(SUPPORT_CLOSE_PREFIX)) {
      const caseId = interaction.customId.slice(SUPPORT_CLOSE_PREFIX.length);
      await handleCloseInteraction({ client, interaction, caseId });
      return;
    }

    if (interaction.customId.startsWith(SUPPORT_TRANSCRIPT_PREFIX)) {
      const caseId = interaction.customId.slice(SUPPORT_TRANSCRIPT_PREFIX.length);
      await handleTranscriptInteraction({ client, interaction, caseId });
    }

    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === SUPPORT_TICKET_DEPARTMENT_SELECT_ID) {
    await handleTicketDepartmentSelectInteraction({ client, interaction });
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith(SUPPORT_TICKET_ESCALATE_SELECT_PREFIX)) {
    const ticketId = interaction.customId.slice(SUPPORT_TICKET_ESCALATE_SELECT_PREFIX.length);
    await handleTicketEscalationSelectInteraction({ client, interaction, ticketId });
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith(SUPPORT_ESCALATE_SELECT_PREFIX)) {
    const caseId = interaction.customId.slice(SUPPORT_ESCALATE_SELECT_PREFIX.length);
    await handleEscalationSelectInteraction({ client, interaction, caseId });
  }
}

async function handleSupportGuildCreate({ client, guild }) {
  if (!client.botContext.moduleConfigStore.isModuleEnabled(guild.id, "support")) {
    return;
  }

  await ensureSupportDefaults(client, guild);
}

async function handleSupportReady({ client }) {
  for (const guild of client.guilds.cache.values()) {
    scheduleClosedTicketDeletionsForGuild(client, guild.id);

    if (!client.botContext.moduleConfigStore.isModuleEnabled(guild.id, "support")) {
      continue;
    }

    await ensureSupportDefaults(client, guild);
  }
}

export const supportModule = {
  name: "support",
  defaultEnabled: false,
  defaultConfig: {
    waitingChannelId: "",
    managementChannelId: "",
    talkCategoryId: "",
    ticketCategoryId: "",
    talkChannelIds: [],
    transcriptTextChannelId: "",
    defaultDepartmentId: "default",
    departments: []
  },
  commands: [
    supportDepartmentCommand,
    supportDepartmentUiCommand,
    supportTicketPanelCommand
  ],
  events: {
    interactionCreate: [handleSupportInteraction],
    guildCreate: [handleSupportGuildCreate],
    ready: [handleSupportReady],
    voiceStateUpdate: [handleSupportVoiceStateUpdate]
  }
};
