import { randomBytes, randomUUID } from "node:crypto";

export function createId(prefix = "") {
  const id = randomUUID().replace(/-/g, "").slice(0, 20);
  return prefix ? `${prefix}_${id}` : id;
}

export function createToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

// Gut vorlesbarer Code für die Steam-Verknüpfung im Spiel (keine 0/O/1/I).
export function createHumanCode(length = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buffer = randomBytes(length);
  let code = "";

  for (let index = 0; index < length; index += 1) {
    code += alphabet[buffer[index] % alphabet.length];
  }

  return code;
}

export function slugify(value, fallback = "eintrag", maxLength = 32) {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLength);

  return slug || fallback;
}
