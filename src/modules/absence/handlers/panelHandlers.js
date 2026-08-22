import { MessageFlags } from "discord.js";

import { canManageServer } from "../../../core/permissions.js";
import { recordAudit } from "../../../core/audit.js";
import { normalizeAbsenceConfig } from "../services/config.js";
import { refreshOverview } from "../services/announce.js";
import { submitAbsence } from "../services/submit.js";
import {
  ABSENCE_FROM_INPUT_ID,
  ABSENCE_PANEL_KIND_SELECT_ID,
  ABSENCE_PANEL_MINE_BUTTON_ID,
  ABSENCE_PANEL_MODAL_PREFIX,
  ABSENCE_PANEL_OPEN_BUTTON_ID,
  ABSENCE_PANEL_WITHDRAW_SELECT_ID,
  ABSENCE_REASON_INPUT_ID,
  ABSENCE_TO_INPUT_ID,
  buildAbsenceModal,
  buildKindSelectPayload,
  buildOwnAbsencesPayload
} from "../services/panel.js";
import {
  ABSENCE_KINDS,
  ABSENCE_STATUS,
  getAbsence,
  listUserAbsences,
  setAbsenceStatus
} from "../services/store.js";

function selfServiceBlocked(client, interaction) {
  const config = normalizeAbsenceConfig(
    client.botContext.settingsStore.getModuleState(interaction.guildId, "absence")?.config
  );

  return !config.allowSelfService && !canManageServer(interaction.member);
}

async function handleOpenButton({ client, interaction }) {
  if (selfServiceBlocked(client, interaction)) {
    await interaction.reply({
      content: "Abmeldungen werden auf diesem Server über das Dashboard eingetragen.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.reply({ ...buildKindSelectPayload(), flags: MessageFlags.Ephemeral });
}

async function handleKindSelect({ interaction }) {
  const kindId = interaction.values[0];

  if (!ABSENCE_KINDS[kindId]) {
    await interaction.reply({ content: "Unbekannte Art.", flags: MessageFlags.Ephemeral });
    return;
  }

  // Auf ein Select darf direkt ein Modal folgen – deshalb kein deferUpdate.
  await interaction.showModal(buildAbsenceModal(kindId));
}

async function handleModalSubmit({ client, interaction }) {
  if (selfServiceBlocked(client, interaction)) {
    await interaction.reply({
      content: "Abmeldungen werden auf diesem Server über das Dashboard eingetragen.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = await submitAbsence({
    client,
    guildId: interaction.guildId,
    member: interaction.member,
    userId: interaction.user.id,
    kind: interaction.customId.slice(ABSENCE_PANEL_MODAL_PREFIX.length),
    von: interaction.fields.getTextInputValue(ABSENCE_FROM_INPUT_ID),
    bis: interaction.fields.getTextInputValue(ABSENCE_TO_INPUT_ID),
    reason: interaction.fields.getTextInputValue(ABSENCE_REASON_INPUT_ID)
  });

  await interaction.editReply({ content: result.text });
}

async function handleMineButton({ interaction }) {
  const absences = listUserAbsences(interaction.guildId, interaction.user.id);

  await interaction.reply({
    ...buildOwnAbsencesPayload(absences),
    flags: MessageFlags.Ephemeral
  });
}

async function handleWithdrawSelect({ client, interaction }) {
  const absenceId = interaction.values[0];
  const absence = getAbsence(absenceId);

  // Die Auswahl stammt aus einer nur für den Nutzer sichtbaren Nachricht,
  // trotzdem wird die Zugehörigkeit geprüft – Werte sind fälschbar.
  if (!absence || absence.userId !== interaction.user.id || absence.guildId !== interaction.guildId) {
    await interaction.update({ content: "Eintrag nicht gefunden.", components: [] });
    return;
  }

  setAbsenceStatus(absenceId, ABSENCE_STATUS.cancelled);

  recordAudit({
    guildId: interaction.guildId,
    actorId: interaction.user.id,
    actorName: interaction.user.username,
    action: "absence.cancel",
    detail: { absenceId }
  });

  await interaction.update({ content: "Abmeldung zurückgezogen.", components: [] });
  await refreshOverview(client, interaction.guildId);
}

/**
 * Verteilt alle Interaktionen des Abmelde-Panels.
 */
export async function handleAbsencePanelInteraction({ client, interaction }) {
  if (!interaction.inGuild()) {
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith(ABSENCE_PANEL_MODAL_PREFIX)) {
    await handleModalSubmit({ client, interaction });
    return;
  }

  if (interaction.isButton()) {
    if (interaction.customId === ABSENCE_PANEL_OPEN_BUTTON_ID) {
      await handleOpenButton({ client, interaction });
      return;
    }

    if (interaction.customId === ABSENCE_PANEL_MINE_BUTTON_ID) {
      await handleMineButton({ client, interaction });
    }

    return;
  }

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === ABSENCE_PANEL_KIND_SELECT_ID) {
      await handleKindSelect({ client, interaction });
      return;
    }

    if (interaction.customId === ABSENCE_PANEL_WITHDRAW_SELECT_ID) {
      await handleWithdrawSelect({ client, interaction });
    }
  }
}
