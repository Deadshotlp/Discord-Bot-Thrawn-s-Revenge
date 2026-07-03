const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export const WEEKDAY_NAMES = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

function toLocalMidnight(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// 0 = Montag ... 6 = Sonntag
function isoDayIndex(date) {
  return (date.getDay() + 6) % 7;
}

export function getWeekMonday(date) {
  const monday = toLocalMidnight(date);
  monday.setDate(monday.getDate() - isoDayIndex(monday));
  return monday;
}

function atWeekdayTime(weekMonday, weekday, hour, minute) {
  const occurrence = new Date(weekMonday);
  occurrence.setDate(weekMonday.getDate() + (weekday - 1));
  occurrence.setHours(hour, minute, 0, 0);
  return occurrence;
}

export function parseAnchorDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) {
    return null;
  }

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getOccurrenceKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Liefert den Meeting-Termin der Intervall-Periode, zu der die Woche von `date`
// gehört. Bei intervalWeeks=1 ist das immer der Termin der aktuellen Woche;
// bei größeren Intervallen der Termin der jüngsten "aktiven" Woche.
function occurrenceForPeriodOf(date, config) {
  const { anchorDate, intervalWeeks, weekday, hour, minute } = config;
  const anchor = parseAnchorDate(anchorDate) || date;
  const anchorMonday = getWeekMonday(anchor);
  const thisMonday = getWeekMonday(date);

  const interval = Math.max(1, intervalWeeks);
  const weeksDiff = Math.round((thisMonday.getTime() - anchorMonday.getTime()) / WEEK_MS);
  const offset = ((weeksDiff % interval) + interval) % interval;

  const periodMonday = new Date(thisMonday);
  periodMonday.setDate(thisMonday.getDate() - offset * 7);

  return atWeekdayTime(periodMonday, weekday, hour, minute);
}

// Kandidaten rund um `date` (jüngste Periode ± ein paar Intervalle), sortiert.
function candidateOccurrences(date, config) {
  const interval = Math.max(1, config.intervalWeeks);
  const base = occurrenceForPeriodOf(date, config);
  const candidates = [];

  for (let step = -2; step <= 2; step += 1) {
    const candidate = new Date(base);
    candidate.setDate(base.getDate() + step * interval * 7);
    candidate.setHours(config.hour, config.minute, 0, 0);
    candidates.push(candidate);
  }

  return candidates.sort((a, b) => a.getTime() - b.getTime());
}

export function getNextOccurrence(now, config) {
  return candidateOccurrences(now, config).find((occurrence) => occurrence.getTime() > now.getTime()) || null;
}

export function getMostRecentOccurrence(now, config) {
  const past = candidateOccurrences(now, config).filter((occurrence) => occurrence.getTime() <= now.getTime());
  return past.length > 0 ? past[past.length - 1] : null;
}

export function formatSchedule(config) {
  const weekdayName = WEEKDAY_NAMES[config.weekday - 1] || "?";
  const time = `${String(config.hour).padStart(2, "0")}:${String(config.minute).padStart(2, "0")}`;
  const rhythm = config.intervalWeeks <= 1
    ? "wöchentlich"
    : `alle ${config.intervalWeeks} Wochen`;
  return `${weekdayName}, ${time} Uhr (${rhythm})`;
}

export function parseWeekdayInput(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) {
    return null;
  }

  const asNumber = Number.parseInt(text, 10);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= 7) {
    return asNumber;
  }

  const index = WEEKDAY_NAMES.findIndex((name) => name.toLowerCase().startsWith(text.slice(0, 2)));
  return index >= 0 ? index + 1 : null;
}

export function parseTimeInput(value) {
  const text = String(value || "").trim();
  const match = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(text);
  if (!match) {
    return null;
  }

  const hour = Number.parseInt(match[1], 10);
  const minute = match[2] ? Number.parseInt(match[2], 10) : 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return { hour, minute };
}
