import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const TRANSCRIBE_TIMEOUT_MS = 5 * 60 * 1000;

// whisper.cpp-Release-Binaries sind dynamisch gelinkt und laden ihre
// Bibliotheken (libwhisper.so, libggml*.so) aus dem eigenen Ordner. Damit der
// Loader sie findet – auch wenn der Bot die Binary von woanders startet –
// setzen wir LD_LIBRARY_PATH auf das Verzeichnis der Binary.
export function buildWhisperSpawnEnv(env, baseEnv = process.env) {
  const binDir = path.dirname(env.whisperBinaryPath);
  const libDir = env.whisperLibDir ? path.resolve(env.whisperLibDir) : binDir;

  const existing = baseEnv.LD_LIBRARY_PATH ? [baseEnv.LD_LIBRARY_PATH] : [];

  return {
    ...baseEnv,
    LD_LIBRARY_PATH: [libDir, ...existing].join(path.delimiter)
  };
}

export function isSpeechToTextConfigured(env) {
  if (!env.whisperBinaryPath || !env.whisperModelPath) {
    return false;
  }

  return fs.existsSync(env.whisperBinaryPath) && fs.existsSync(env.whisperModelPath);
}

export function buildWhisperArgs({ modelPath, wavPath, language, threads }) {
  const safeThreads = Number.isInteger(threads) && threads > 0 ? Math.min(threads, 16) : 2;

  return [
    "-m", modelPath,
    "-f", wavPath,
    "-l", language || "de",
    "-t", String(safeThreads),
    "-nt",
    "-np"
  ];
}

function runWhisper(env, wavPath) {
  return new Promise((resolve, reject) => {
    const args = buildWhisperArgs({
      modelPath: env.whisperModelPath,
      wavPath,
      language: env.whisperLanguage,
      threads: env.whisperThreads
    });

    const child = spawn(env.whisperBinaryPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: buildWhisperSpawnEnv(env)
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      settled = true;
      child.kill("SIGKILL");
      reject(new Error("Whisper-Transkription hat das Zeitlimit überschritten"));
    }, TRANSCRIBE_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);

      if (code !== 0) {
        reject(new Error(`Whisper beendet mit Code ${code}: ${stderr.slice(0, 300)}`));
        return;
      }

      resolve(stdout.replace(/\s+/g, " ").trim());
    });
  });
}

// Transkriptionen laufen strikt nacheinander, damit der Bot-Prozess
// (geteilte CPU im Wings-Container) nicht überlastet wird.
let queueTail = Promise.resolve();

export function enqueueTranscription(env, wavPath) {
  const job = queueTail.then(() => runWhisper(env, wavPath));
  queueTail = job.catch(() => null);
  return job;
}
