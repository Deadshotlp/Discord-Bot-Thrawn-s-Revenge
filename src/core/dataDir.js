import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Immer relativ zum Projekt auflösen, nicht zum Arbeitsverzeichnis,
// damit Config und Datenbanken unabhängig vom Startort an derselben Stelle liegen.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(projectRoot, "data");

export function ensureDataDir() {
  fs.mkdirSync(dataDir, { recursive: true });
  return dataDir;
}
