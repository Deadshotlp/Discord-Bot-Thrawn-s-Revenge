const DAY_MS = 24 * 60 * 60 * 1000;

const WEEK_KEY_PATTERN = /^(\d{4})-W(\d{2})$/;

export const WEEKDAY_NAMES = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

function toLocalMidnight(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// 0 = Montag ... 6 = Sonntag (ISO-Wochentag minus 1)
function getIsoDayIndex(date) {
  return (date.getDay() + 6) % 7;
}

export function getIsoWeekParts(date = new Date()) {
  // Der Donnerstag der Woche bestimmt Jahr und Wochennummer (ISO 8601).
  const thursday = toLocalMidnight(date);
  thursday.setDate(thursday.getDate() - getIsoDayIndex(thursday) + 3);

  const isoYear = thursday.getFullYear();

  const firstThursday = new Date(isoYear, 0, 4);
  firstThursday.setDate(firstThursday.getDate() - getIsoDayIndex(firstThursday) + 3);

  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
  return { year: isoYear, week };
}

export function getIsoWeekKey(date = new Date()) {
  const { year, week } = getIsoWeekParts(date);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function parseWeekKey(weekKey) {
  const match = WEEK_KEY_PATTERN.exec(String(weekKey || "").trim());
  if (!match) {
    return null;
  }

  return {
    year: Number.parseInt(match[1], 10),
    week: Number.parseInt(match[2], 10)
  };
}

export function getIsoWeekMonday(date = new Date()) {
  const monday = toLocalMidnight(date);
  monday.setDate(monday.getDate() - getIsoDayIndex(monday));
  return monday;
}

export function getMondayOfWeekKey(weekKey) {
  const parts = parseWeekKey(weekKey);
  if (!parts) {
    return null;
  }

  // Der 4. Januar liegt immer in Woche 1 des ISO-Jahres.
  const monday = getIsoWeekMonday(new Date(parts.year, 0, 4));
  monday.setDate(monday.getDate() + (parts.week - 1) * 7);
  return monday;
}

export function formatWeekLabel(weekKey) {
  const parts = parseWeekKey(weekKey);
  if (!parts) {
    return String(weekKey || "");
  }

  return `KW ${parts.week} / ${parts.year}`;
}

export function formatWeekDateRange(weekKey) {
  const monday = getMondayOfWeekKey(weekKey);
  if (!monday) {
    return "";
  }

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const formatter = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${formatter.format(monday)} – ${formatter.format(sunday)}`;
}

// Veröffentlichungszeitpunkt innerhalb der ISO-Woche, in der `date` liegt.
export function getPublishMoment(date, { publishWeekday, publishHour, publishMinute }) {
  const monday = getIsoWeekMonday(date);
  const moment = new Date(monday);
  moment.setDate(monday.getDate() + (publishWeekday - 1));
  moment.setHours(publishHour, publishMinute, 0, 0);
  return moment;
}

export function getPublishMomentOfWeekKey(weekKey, config) {
  const monday = getMondayOfWeekKey(weekKey);
  if (!monday) {
    return null;
  }

  return getPublishMoment(monday, config);
}

// Die Woche, der eine Abgabe zum Zeitpunkt `now` zugeordnet wird:
// Vor dem Veröffentlichungstermin zählt sie zur laufenden Woche,
// danach bereits zur nächsten.
export function getTargetWeekKey(now, config) {
  const moment = getPublishMoment(now, config);
  if (now.getTime() < moment.getTime()) {
    return getIsoWeekKey(now);
  }

  const nextWeekRef = getIsoWeekMonday(now);
  nextWeekRef.setDate(nextWeekRef.getDate() + 10);
  return getIsoWeekKey(nextWeekRef);
}

export function getPreviousWeekKey(date = new Date()) {
  const prevWeekRef = getIsoWeekMonday(date);
  prevWeekRef.setDate(prevWeekRef.getDate() - 4);
  return getIsoWeekKey(prevWeekRef);
}
