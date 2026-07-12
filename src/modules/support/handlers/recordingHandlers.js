import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js";
import { isSpeechToTextConfigured } from "../services/speechToText.js";
import {
  addRecordingConsent,
  createPendingRecordingSession,
  getRecordingSession,
  hasAllConsents,
  startRecording
} from "../services/voiceRecording.js";
import { finalizeVoiceTranscript } from "../services/voiceTranscript.js";
import { getSupportConfig } from "../services/channelResolvers.js";
import { getSupportCase } from "../services/cases.js";

export const SUPPORT_RECORD_CONSENT_PREFIX = "support_record_consent:";
export const SUPPORT_RECORD_STOP_PREFIX = "support_record_stop:";

function buildConsentPayload(caseId, consentedCount, requiredCount) {
  return {
    content: [
      "🎙️ **Gesprächstranskript möglich**",
      "Dieses Support-Gespräch kann aufgezeichnet und automatisch transkribiert werden.",
      "Die Aufnahme startet erst, wenn **beide Teilnehmer** zustimmen. Es wird nur aufgenommen, wer zugestimmt hat.",
      "Die Audio-Daten werden nach der Transkription gelöscht; nur der Text bleibt erhalten.",
      "",
      `Zustimmungen: ${consentedCount}/${requiredCount}`
    ].join("\n"),
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${SUPPORT_RECORD_CONSENT_PREFIX}${caseId}`)
          .setLabel("Aufnahme zustimmen")
          .setStyle(ButtonStyle.Success)
      )
    ]
  };
}

function buildRecordingActivePayload(caseId) {
  return {
    content: [
      "🔴 **Aufnahme läuft** – dieses Gespräch wird transkribiert.",
      "Beim Schließen des Falls wird das Transkript automatisch erstellt."
    ].join("\n"),
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${SUPPORT_RECORD_STOP_PREFIX}${caseId}`)
          .setLabel("Aufnahme beenden")
          .setStyle(ButtonStyle.Danger)
      )
    ]
  };
}

// Wird nach dem Claim aufgerufen: postet die Zustimmungs-Anfrage in den Talk-Channel.
export async function offerRecordingConsent(client, guild, caseData, talkChannel) {
  const { env, logger } = client.botContext;

  if (!isSpeechToTextConfigured(env)) {
    return;
  }

  const session = createPendingRecordingSession({
    guildId: guild.id,
    caseId: caseData.id,
    channelId: talkChannel.id,
    requiredUserIds: [caseData.userId, caseData.supporterId].filter(Boolean)
  });

  const message = await talkChannel
    .send(buildConsentPayload(caseData.id, session.consentedUserIds.size, session.requiredUserIds.size))
    .catch((error) => {
      logger.warn("Support-Aufnahme: Zustimmungs-Nachricht fehlgeschlagen", {
        guildId: guild.id,
        caseId: caseData.id,
        error: String(error)
      });
      return null;
    });

  if (message) {
    session.consentMessageId = message.id;
  }
}

export async function handleRecordingConsentInteraction({ client, interaction, caseId }) {
  const session = addRecordingConsent(interaction.guildId, caseId, interaction.user.id);

  if (!session) {
    await interaction.reply({
      content: "Für dieses Gespräch ist keine Zustimmung (mehr) möglich oder du bist kein Teilnehmer.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (session.status === "pending" && hasAllConsents(session)) {
    const started = await startRecording(session, interaction.guild, client.botContext.env, client.botContext.logger);

    if (started) {
      await interaction.update(buildRecordingActivePayload(caseId)).catch(() => null);
      return;
    }

    await interaction.reply({
      content: "Aufnahme konnte nicht gestartet werden (Voice-Verbindung fehlgeschlagen).",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction
    .update(buildConsentPayload(caseId, session.consentedUserIds.size, session.requiredUserIds.size))
    .catch(() => null);
}

export async function handleRecordingStopInteraction({ client, interaction, caseId }) {
  const session = getRecordingSession(interaction.guildId, caseId);

  if (!session || session.status !== "recording") {
    await interaction.reply({
      content: "Es läuft keine Aufnahme für diesen Fall.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!session.requiredUserIds.has(interaction.user.id)) {
    await interaction.reply({
      content: "Nur Gesprächsteilnehmer dürfen die Aufnahme beenden.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.update({
    content: "⏹️ Aufnahme beendet. Das Transkript wird erstellt …",
    components: []
  }).catch(() => null);

  const caseData = getSupportCase(interaction.guildId, caseId);
  const config = getSupportConfig(client.botContext.moduleConfigStore, interaction.guildId, client.botContext.env);

  const posted = await finalizeVoiceTranscript(client, interaction.guild, caseData || { id: caseId }, config);

  await interaction.message
    .edit({
      content: posted
        ? "⏹️ Aufnahme beendet. Das Gesprächstranskript wurde im Verwaltungs-Channel gepostet."
        : "⏹️ Aufnahme beendet. Es kam kein verwertbares Transkript zustande.",
      components: []
    })
    .catch(() => null);
}
