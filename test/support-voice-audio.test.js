import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildWavFileBuffer,
  downmixTo16kMono,
  getPcmDurationMs,
  WHISPER_SAMPLE_RATE
} from "../src/modules/support/services/audio.js";
import { buildWhisperArgs } from "../src/modules/support/services/speechToText.js";
import { formatVoiceTranscript } from "../src/modules/support/services/voiceTranscript.js";

test("buildWavFileBuffer writes a valid 44-byte PCM header", () => {
  const pcm = Buffer.alloc(320);
  const wav = buildWavFileBuffer(pcm, WHISPER_SAMPLE_RATE, 1);

  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.toString("ascii", 36, 40), "data");
  assert.equal(wav.readUInt32LE(4), 36 + pcm.length);
  assert.equal(wav.readUInt16LE(22), 1); // channels
  assert.equal(wav.readUInt32LE(24), WHISPER_SAMPLE_RATE);
  assert.equal(wav.readUInt16LE(34), 16); // bits per sample
  assert.equal(wav.readUInt32LE(40), pcm.length);
  assert.equal(wav.length, 44 + pcm.length);
});

test("downmixTo16kMono reduces stereo 48k to mono 16k and averages channels", () => {
  // 6 Stereo-Frames (48k) -> 2 Mono-Samples (16k, jedes dritte Frame).
  const stereo = Buffer.alloc(6 * 4);
  for (let frame = 0; frame < 6; frame += 1) {
    stereo.writeInt16LE(100, frame * 4);
    stereo.writeInt16LE(200, frame * 4 + 2);
  }

  const mono = downmixTo16kMono(stereo);
  assert.equal(mono.length, 2 * 2);
  assert.equal(mono.readInt16LE(0), 150);
  assert.equal(mono.readInt16LE(2), 150);
});

test("getPcmDurationMs computes duration from sample count", () => {
  const oneSecond = Buffer.alloc(WHISPER_SAMPLE_RATE * 2);
  assert.equal(getPcmDurationMs(oneSecond), 1000);
});

test("buildWhisperArgs passes model, file, language and clamps threads", () => {
  const args = buildWhisperArgs({
    modelPath: "/models/ggml.bin",
    wavPath: "/tmp/a.wav",
    language: "de",
    threads: 999
  });

  assert.deepEqual(args, [
    "-m", "/models/ggml.bin",
    "-f", "/tmp/a.wav",
    "-l", "de",
    "-t", "16",
    "-nt",
    "-np"
  ]);
});

test("buildWhisperArgs falls back to safe defaults", () => {
  const args = buildWhisperArgs({ modelPath: "m", wavPath: "w", language: "", threads: 0 });
  assert.equal(args[args.indexOf("-l") + 1], "de");
  assert.equal(args[args.indexOf("-t") + 1], "2");
});

test("formatVoiceTranscript renders speaker lines in order", () => {
  const transcript = formatVoiceTranscript("abc-123", [
    { startedAt: new Date(2026, 0, 1, 14, 32, 5).getTime(), speakerName: "Supporter", text: "Hallo" },
    { startedAt: new Date(2026, 0, 1, 14, 32, 9).getTime(), speakerName: "Nutzer", text: "Servus" }
  ]);

  assert.match(transcript, /Fall abc-123/);
  assert.match(transcript, /Supporter: Hallo/);
  assert.match(transcript, /Nutzer: Servus/);
  assert.ok(transcript.indexOf("Supporter: Hallo") < transcript.indexOf("Nutzer: Servus"));
});
