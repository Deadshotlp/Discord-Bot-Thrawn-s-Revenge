import { AttachmentBuilder } from "discord.js";
import { resolveTranscriptChannel } from "./channelResolvers.js";
import { endRecordingSession, stopRecording } from "./voiceRecording.js";

function formatClockTime(timestamp) {
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(timestamp));
}

export function formatVoiceTranscript(caseId, entries) {
  const lines = [
    `Gesprächstranskript – Fall ${caseId}`,
    "Automatisch erstellt (lokale Spracherkennung). Ohne Gewähr für Wortlaut.",
    ""
  ];

  for (const entry of entries) {
    lines.push(`[${formatClockTime(entry.startedAt)}] ${entry.speakerName}: ${entry.text}`);
  }

  return lines.join("\n");
}

async function resolveSpeakerName(guild, userId) {
  const member = guild.members.cache.get(userId)
    || (await guild.members.fetch(userId).catch(() => null));

  return member?.displayName || `Unbekannt (${userId})`;
}

// Stoppt die Aufnahme, wartet auf ausstehende Transkriptionen und postet das
// fertige Gesprächstranskript in den Transkript-Channel.
export async function finalizeVoiceTranscript(client, guild, caseData, config) {
  const { logger } = client.botContext;
  const session = stopRecording(guild.id, caseData.id);

  if (!session) {
    return false;
  }

  try {
    if (session.segments.length === 0) {
      logger.warn("Support-Aufnahme: keine Audiodaten empfangen (0 Segmente)", {
        guildId: guild.id,
        caseId: caseData.id
      });
      return false;
    }

    const entries = [];
    for (const segment of session.segments) {
      const text = (await segment.textPromise) || "";
      if (!text) {
        continue;
      }

      entries.push({
        startedAt: segment.startedAt,
        speakerName: await resolveSpeakerName(guild, segment.userId),
        text
      });
    }

    logger.info("Support-Aufnahme ausgewertet", {
      guildId: guild.id,
      caseId: caseData.id,
      segments: session.segments.length,
      transkribiert: entries.length
    });

    if (entries.length === 0) {
      return false;
    }

    entries.sort((a, b) => a.startedAt - b.startedAt);
    const transcriptContent = formatVoiceTranscript(caseData.id, entries);

    const transcriptChannel = await resolveTranscriptChannel(guild, config);
    if (!transcriptChannel) {
      logger.warn("Support-Aufnahme: Transkript-Channel nicht verfügbar", {
        guildId: guild.id,
        caseId: caseData.id
      });
      return false;
    }

    const attachment = new AttachmentBuilder(Buffer.from(transcriptContent, "utf8"), {
      name: `support-case-${caseData.id}-gespraech.txt`
    });

    await transcriptChannel.send({
      content: `Gesprächstranskript für Fall ${caseData.id} (${entries.length} Wortmeldungen)`,
      files: [attachment]
    });

    return true;
  } catch (error) {
    logger.warn("Support-Aufnahme: Gesprächstranskript fehlgeschlagen", {
      guildId: guild.id,
      caseId: caseData.id,
      error: String(error)
    });
    return false;
  } finally {
    endRecordingSession(guild.id, caseData.id);
  }
}
