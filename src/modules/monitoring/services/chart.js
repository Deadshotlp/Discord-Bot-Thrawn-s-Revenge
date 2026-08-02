import { downsample } from "./stats.js";

const QUICKCHART_BASE = "https://quickchart.io/chart";

// Discord weist embed.image.url über 2048 Zeichen mit Fehler 50035 ab. Die
// Chart-Konfiguration steckt komplett in der URL, deshalb muss sie darunter
// bleiben – siehe fitUrl().
export const MAX_IMAGE_URL_LENGTH = 2048;

// Unter dieser Punktzahl lohnt sich ein Verlaufsdiagramm nicht mehr.
const MIN_POINTS = 8;

// Jede Linie kostet in der URL rund 110 Zeichen Grundgerüst und geht von der
// Auflösung ab. Mehr als sechs Server passen selbst bei gröbster Auflösung
// nicht mehr ins Längenlimit – und wären als Liniengewirr ohnehin unlesbar.
export const MAX_COMPARISON_SERIES = 6;

// Discord-Dunkelblau als Hintergrund, damit das Bild im Embed nicht als
// weißer Kasten hervorsticht.
const BACKGROUND = "#1e1f22";
// Achtstellige Hex-Farben statt rgba(): gleiche Wirkung, aber ohne Kommas,
// die in der URL je drei Zeichen kosten würden.
const GRID = "#ffffff10";
const TEXT = "#b5bac1";
const TITLE = "#f2f3f5";

function withAlpha(hex, alpha) {
  const value = String(hex || "#5865f2").replace("#", "");
  const full = value.length === 3
    ? value.split("").map((char) => char + char).join("")
    : value.padEnd(6, "0").slice(0, 6);

  const suffix = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");

  return `#${full}${suffix}`;
}

function round1(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function formatTimeLabel(timestamp, span) {
  const date = new Date(timestamp);

  if (span <= 36 * 60 * 60 * 1000) {
    return new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(date);
  }

  if (span <= 14 * 24 * 60 * 60 * 1000) {
    return new Intl.DateTimeFormat("de-DE", { weekday: "short", hour: "2-digit" }).format(date);
  }

  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" }).format(date);
}

/**
 * Nur jede n-te Beschriftung wird gesetzt; die übrigen bleiben leer. Das hält
 * die Achse lesbar und spart pro Punkt rund die Hälfte der Zeichen.
 */
function sparseLabels(data, span, wanted = 8) {
  const step = Math.max(1, Math.ceil(data.length / wanted));

  return data.map((point, index) => (
    index % step === 0 || index === data.length - 1 ? formatTimeLabel(point.at, span) : ""
  ));
}

function baseOptions(titleText) {
  return {
    // Gemeinsame Linien- und Punktstile stehen bewusst hier statt in jeder
    // Datenreihe: bei mehreren Servern spart das je Reihe rund 120 Zeichen.
    elements: {
      point: { radius: 0 },
      line: { tension: 0.35, borderWidth: 2, fill: false }
    },
    plugins: {
      title: {
        display: Boolean(titleText),
        text: titleText,
        color: TITLE,
        font: { size: 15, weight: "bold" }
      },
      legend: {
        position: "top",
        align: "end",
        labels: { color: TEXT, usePointStyle: true, pointStyle: "line", boxWidth: 18 }
      }
    },
    scales: {
      x: {
        grid: { color: GRID },
        ticks: { color: TEXT, autoSkip: false, maxRotation: 0 }
      },
      y: {
        beginAtZero: true,
        grid: { color: GRID },
        ticks: { color: TEXT, precision: 0 }
      }
    }
  };
}

function encodeConfig(config) {
  // "," und ":" sind laut RFC 3986 im Query-Teil erlaubt und müssen nicht
  // prozentkodiert werden. Bei einer Datenreihe mit hunderten Trennzeichen
  // spart das mehrere hundert Zeichen und damit zusätzliche Messpunkte.
  return encodeURIComponent(JSON.stringify(config))
    .replace(/%2C/g, ",")
    .replace(/%3A/g, ":");
}

function toUrl(chartConfig, { width = 760, height = 320 } = {}) {
  const query = `v=4&w=${width}&h=${height}&devicePixelRatio=2&bkg=${encodeURIComponent(BACKGROUND)}`;
  return `${QUICKCHART_BASE}?${query}&c=${encodeConfig(chartConfig)}`;
}

/**
 * Baut die URL mit der höchsten Auflösung, die noch in Discords Längenlimit
 * passt. `build` bekommt die gewünschte Punktzahl und liefert die Chart-Config.
 * Gesucht wird per Halbierung, damit die Kurve nicht unnötig grob wird.
 * Passt selbst die gröbste Auflösung nicht, gibt es kein Bild statt eines
 * abgewiesenen Embeds.
 */
function fitUrl(build, targetPoints, size) {
  const attempt = (count) => {
    const url = toUrl(build(count), size);
    return url.length <= MAX_IMAGE_URL_LENGTH ? url : "";
  };

  let high = Math.max(MIN_POINTS, targetPoints);
  const full = attempt(high);

  if (full) {
    return full;
  }

  let low = MIN_POINTS;
  let best = "";

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const url = attempt(middle);

    if (url) {
      best = url;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return best;
}

/**
 * Verlaufs-Diagramm: gefüllte, geglättete Kurve für den Durchschnitt und eine
 * dünne Linie für den Peak. Die Slot-Zahl steht im Titel statt als eigene
 * Datenreihe – als Linie würde sie die Y-Achse auf die Serverkapazität
 * strecken und die Kurve flachdrücken.
 */
export function buildPlayerHistoryChartUrl(points, {
  color = "#5865f2",
  title = "Spielerverlauf",
  targetPoints = 90,
  showPeak = true,
  showCapacity = true
} = {}) {
  const source = points || [];

  if (source.length < 2) {
    return "";
  }

  const build = (count) => {
    const data = downsample(source, count);
    const span = data.at(-1).at - data[0].at;
    const capacity = Math.max(...data.map((point) => Number(point.maxPlayers || 0)));

    const datasets = [
      {
        label: "Ø Spieler",
        data: data.map((point) => round1(point.players)),
        borderColor: color,
        borderWidth: 2.5,
        fill: true,
        // Kein getGradientFillHelper: der wird von QuickChart nur ausgewertet,
        // wenn die Konfiguration als JavaScript geparst wird. Als JSON-String
        // käme er als ungültige Farbe an und die Fläche bliebe leer.
        backgroundColor: withAlpha(color, 0.16)
      }
    ];

    if (showPeak) {
      datasets.push({
        label: "Peak",
        data: data.map((point) => round1(point.peak)),
        borderColor: withAlpha("#ffffff", 0.45),
        borderWidth: 1.2
      });
    }

    const heading = showCapacity && capacity > 0 ? `${title} · ${capacity} Slots` : title;

    return {
      type: "line",
      data: { labels: sparseLabels(data, span), datasets },
      options: baseOptions(heading)
    };
  };

  return fitUrl(build, Math.min(targetPoints, source.length));
}

/**
 * Tagesprofil: durchschnittliche Spielerzahl je Stunde – zeigt auf einen Blick,
 * wann sich Events oder Support-Schichten lohnen.
 */
export function buildHourProfileChartUrl(hourProfile, { color = "#5865f2", title = "Aktivität nach Uhrzeit" } = {}) {
  if (!Array.isArray(hourProfile) || hourProfile.every((entry) => entry.average === 0)) {
    return "";
  }

  const options = baseOptions(title);
  options.plugins.legend = { display: false };

  const url = toUrl({
    type: "bar",
    data: {
      labels: hourProfile.map((entry) => String(entry.hour).padStart(2, "0")),
      datasets: [
        {
          label: "Ø Spieler",
          data: hourProfile.map((entry) => round1(entry.average)),
          backgroundColor: withAlpha(color, 0.65),
          borderColor: color,
          borderRadius: 4
        }
      ]
    },
    options
  }, { width: 760, height: 240 });

  return url.length <= MAX_IMAGE_URL_LENGTH ? url : "";
}

function multiServerConfig(entries, title) {
  const reference = entries.reduce(
    (best, entry) => (entry.points.length > best.points.length ? entry : best),
    entries[0]
  );
  const span = reference.points.at(-1).at - reference.points[0].at;

  return {
    type: "line",
    data: {
      labels: sparseLabels(reference.points, span),
      datasets: entries.map((entry) => ({
        label: entry.name,
        data: entry.points.map((point) => round1(point.players)),
        borderColor: entry.color || "#5865f2",
        // Nur bei einem einzelnen Server lohnt die Füllfläche; bei mehreren
        // würden sich die Flächen gegenseitig verdecken.
        ...(entries.length === 1
          ? { fill: true, backgroundColor: withAlpha(entry.color || "#5865f2", 0.12) }
          : {})
      }))
    },
    options: baseOptions(title)
  };
}

/**
 * Vergleichs-Diagramm über mehrere Server – eine Linie je Server. Die Reihen
 * werden in der übergebenen Reihenfolge berücksichtigt; passen sie nicht alle
 * ins Längenlimit, fallen die hinteren weg. `shown` sagt, wie viele davon
 * tatsächlich im Bild sind, damit der Aufrufer darauf hinweisen kann.
 *
 * @returns {{ url: string, shown: number }}
 */
export function buildMultiServerChartUrl(series, { title = "Serververgleich", targetPoints = 70 } = {}) {
  const source = (series || []).filter((entry) => (entry.points || []).length >= 2);

  if (source.length === 0) {
    return { url: "", shown: 0 };
  }

  for (let count = Math.min(source.length, MAX_COMPARISON_SERIES); count >= 1; count -= 1) {
    const subset = source.slice(0, count);
    const longest = Math.max(...subset.map((entry) => entry.points.length));

    const url = fitUrl((points) => multiServerConfig(
      subset
        .map((entry) => ({ ...entry, points: downsample(entry.points, points) }))
        .filter((entry) => entry.points.length >= 2),
      title
    ), Math.min(targetPoints, longest));

    if (url) {
      return { url, shown: count };
    }
  }

  return { url: "", shown: 0 };
}
