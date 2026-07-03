// PCM-Hilfsfunktionen für die Sprachaufnahme.
// Discord liefert 48 kHz Stereo (16-bit LE), whisper.cpp erwartet 16 kHz Mono.

export const DISCORD_SAMPLE_RATE = 48000;
export const WHISPER_SAMPLE_RATE = 16000;

// Stereo 48 kHz -> Mono 16 kHz: Kanäle mitteln, jedes dritte Sample übernehmen.
// Für Sprache ist einfache Dezimation ausreichend.
export function downmixTo16kMono(stereo48kBuffer) {
  const frameBytes = 4; // 2 Kanäle * 2 Byte
  const frameCount = Math.floor(stereo48kBuffer.length / frameBytes);
  const outputSamples = Math.floor(frameCount / 3);
  const output = Buffer.alloc(outputSamples * 2);

  for (let outIndex = 0; outIndex < outputSamples; outIndex += 1) {
    const frameOffset = outIndex * 3 * frameBytes;
    const left = stereo48kBuffer.readInt16LE(frameOffset);
    const right = stereo48kBuffer.readInt16LE(frameOffset + 2);
    output.writeInt16LE(Math.round((left + right) / 2), outIndex * 2);
  }

  return output;
}

export function buildWavFileBuffer(pcmBuffer, sampleRate = WHISPER_SAMPLE_RATE, channels = 1) {
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;

  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bytesPerSample * 8, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcmBuffer.length, 40);

  return Buffer.concat([header, pcmBuffer]);
}

export function getPcmDurationMs(pcmBuffer, sampleRate = WHISPER_SAMPLE_RATE, channels = 1) {
  const samples = pcmBuffer.length / (2 * channels);
  return Math.round((samples / sampleRate) * 1000);
}
