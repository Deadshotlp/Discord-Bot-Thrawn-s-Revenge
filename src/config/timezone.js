import "dotenv/config";

export const DEFAULT_TIMEZONE = "Europe/Berlin";

function isValidTimezone(name) {
  try {
    new Intl.DateTimeFormat("de-DE", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/**
 * Legt die Zeitzone des Prozesses fest.
 *
 * Terminlogik (Meetings, Wochenberichte, Abmeldungen) und die Tagesbuckets der
 * Statistiken rechnen mit `setHours()` bzw. SQLite-`localtime` und richten sich
 * damit nach der Prozess-Zeitzone. Container laufen ohne gesetztes TZ auf UTC,
 * wodurch ein auf 16:00 gestelltes Meeting in Discord als 18:00 erscheint.
 *
 * Ein zur Laufzeit gesetztes `process.env.TZ` wirkt in Node ab v16 sowohl auf
 * Date/Intl als auch auf die libc – und damit auf better-sqlite3.
 */
export function applyTimezone(rawTimezone = process.env.BOT_TIMEZONE, currentTz = process.env.TZ) {
  const requested = String(rawTimezone || "").trim();
  const inherited = String(currentTz || "").trim();

  let timezone = requested || inherited || DEFAULT_TIMEZONE;
  let source = requested ? "BOT_TIMEZONE" : (inherited ? "TZ" : "Standard");
  let warning = "";

  if (!isValidTimezone(timezone)) {
    warning = `Unbekannte Zeitzone "${timezone}", es wird ${DEFAULT_TIMEZONE} verwendet.`;
    timezone = DEFAULT_TIMEZONE;
    source = "Standard";
  }

  process.env.TZ = timezone;

  return {
    timezone,
    source,
    warning,
    resolved: Intl.DateTimeFormat().resolvedOptions().timeZone
  };
}

export const timezoneInfo = applyTimezone();
