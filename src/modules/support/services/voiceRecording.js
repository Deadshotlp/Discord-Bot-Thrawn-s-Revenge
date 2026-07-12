import fs from "node:fs";
import path from "node:path";
import {
  EndBehaviorType,
  entersState,
  joinVoiceChannel,
  VoiceConnectionStatus
} from "@discordjs/voice";
import prism from "prism-media";
import { dataDir } from "../../../core/dataDir.js";
import { buildWavFileBuffer, downmixTo16kMono, getPcmDurationMs } from "./audio.js";
import { enqueueTranscription } from "./speechToText.js";

const SILENCE_END_MS = 1200;
const MIN_SEGMENT_MS = 400;
const MAX_SEGMENTS_PER_SESSION = 2000;

const voiceTmpDir = path.join(dataDir, "voice-tmp");

const sessions = new Map();

function sessionKey(guildId, caseId) {
  return `${guildId}:${caseId}`;
}

export function cleanupVoiceTmpDir() {
  fs.rmSync(voiceTmpDir, { recursive: true, force: true });
}

export function getRecordingSession(guildId, caseId) {
  return sessions.get(sessionKey(guildId, caseId)) || null;
}

export function createPendingRecordingSession({ guildId, caseId, channelId, requiredUserIds }) {
  const key = sessionKey(guildId, caseId);
  if (sessions.has(key)) {
    return sessions.get(key);
  }

  const session = {
    guildId,
    caseId,
    channelId,
    status: "pending",
    requiredUserIds: new Set(requiredUserIds),
    consentedUserIds: new Set(),
    consentMessageId: "",
    connection: null,
    activeStreams: new Map(),
    segments: [],
    startedAt: 0
  };

  sessions.set(key, session);
  return session;
}

export function addRecordingConsent(guildId, caseId, userId) {
  const session = getRecordingSession(guildId, caseId);
  if (!session || session.status === "stopped") {
    return null;
  }

  if (!session.requiredUserIds.has(userId)) {
    return null;
  }

  session.consentedUserIds.add(userId);
  return session;
}

export function hasAllConsents(session) {
  return [...session.requiredUserIds].every((userId) => session.consentedUserIds.has(userId));
}

function subscribeToUser(session, env, logger, userId) {
  if (session.status !== "recording" || session.activeStreams.has(userId)) {
    return;
  }

  if (!session.consentedUserIds.has(userId)) {
    return;
  }

  if (session.segments.length >= MAX_SEGMENTS_PER_SESSION) {
    return;
  }

  const receiver = session.connection?.receiver;
  if (!receiver) {
    return;
  }

  const startedAt = Date.now();
  const opusStream = receiver.subscribe(userId, {
    end: {
      behavior: EndBehaviorType.AfterSilence,
      duration: SILENCE_END_MS
    }
  });

  const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
  const chunks = [];

  session.activeStreams.set(userId, opusStream);

  decoder.on("data", (chunk) => {
    chunks.push(chunk);
  });

  const finish = () => {
    session.activeStreams.delete(userId);

    const pcm48kStereo = Buffer.concat(chunks);
    const pcm16kMono = downmixTo16kMono(pcm48kStereo);

    if (getPcmDurationMs(pcm16kMono) < MIN_SEGMENT_MS) {
      return;
    }

    try {
      const segmentDir = path.join(voiceTmpDir, `${session.guildId}-${session.caseId}`);
      fs.mkdirSync(segmentDir, { recursive: true });

      const filePath = path.join(segmentDir, `${startedAt}-${userId}.wav`);
      fs.writeFileSync(filePath, buildWavFileBuffer(pcm16kMono));

      const segment = {
        userId,
        startedAt,
        filePath,
        textPromise: enqueueTranscription(env, filePath).catch((error) => {
          logger.warn("Support-Aufnahme: Transkription eines Segments fehlgeschlagen", {
            guildId: session.guildId,
            caseId: session.caseId,
            error: String(error)
          });
          return "";
        })
      };

      session.segments.push(segment);
    } catch (error) {
      logger.warn("Support-Aufnahme: Segment konnte nicht gespeichert werden", {
        guildId: session.guildId,
        caseId: session.caseId,
        error: String(error)
      });
    }
  };

  decoder.on("end", finish);
  decoder.on("error", (error) => {
    logger.warn("Support-Aufnahme: Opus-Decoder-Fehler", {
      guildId: session.guildId,
      caseId: session.caseId,
      error: String(error)
    });
    finish();
  });

  opusStream.on("error", () => {
    opusStream.unpipe?.(decoder);
    decoder.end();
  });

  opusStream.pipe(decoder);
}

export async function startRecording(session, guild, env, logger) {
  if (session.status !== "pending") {
    return session.status === "recording";
  }

  const connection = joinVoiceChannel({
    channelId: session.channelId,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: true
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
  } catch (error) {
    connection.destroy();
    logger.warn("Support-Aufnahme: Voice-Verbindung fehlgeschlagen", {
      guildId: guild.id,
      caseId: session.caseId,
      error: String(error)
    });
    return false;
  }

  session.connection = connection;
  session.status = "recording";
  session.startedAt = Date.now();

  connection.receiver.speaking.on("start", (userId) => {
    subscribeToUser(session, env, logger, userId);
  });

  connection.on(VoiceConnectionStatus.Disconnected, () => {
    if (session.status === "recording") {
      session.status = "stopped";
    }
  });

  return true;
}

// Beendet die Aufnahme und liefert die Segmente zurück. Die Session bleibt
// registriert, bis endRecordingSession() sie endgültig entfernt.
export function stopRecording(guildId, caseId) {
  const session = getRecordingSession(guildId, caseId);
  if (!session) {
    return null;
  }

  session.status = "stopped";

  for (const stream of session.activeStreams.values()) {
    stream.destroy();
  }
  session.activeStreams.clear();

  if (session.connection) {
    try {
      session.connection.destroy();
    } catch {
      // Verbindung war bereits getrennt.
    }
    session.connection = null;
  }

  return session;
}

export function endRecordingSession(guildId, caseId) {
  const session = stopRecording(guildId, caseId);
  sessions.delete(sessionKey(guildId, caseId));

  if (session) {
    const segmentDir = path.join(voiceTmpDir, `${guildId}-${caseId}`);
    fs.rmSync(segmentDir, { recursive: true, force: true });
  }

  return session;
}

export function stopAllRecordingSessions() {
  for (const session of sessions.values()) {
    stopRecording(session.guildId, session.caseId);
  }
  sessions.clear();
}
