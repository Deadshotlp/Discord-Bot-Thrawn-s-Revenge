import { downsample } from "./stats.js";

const QUICKCHART_BASE = "https://quickchart.io/chart";

// Discord-Dunkelblau als Hintergrund, damit das Bild im Embed nicht als
// weißer Kasten hervorsticht.
const BACKGROUND = "#1e1f22";
const GRID = "rgba(255,255,255,0.06)";
const TEXT = "#b5bac1";
const TITLE = "#f2f3f5";

function hexToRgba(hex, alpha) {
  const value = String(hex || "#5865f2").replace("#", "");
  const full = value.length === 3
    ? value.split("").map((char) => char + char).join("")
    : value.padEnd(6, "0").slice(0, 6);

  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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

function baseOptions(titleText) {
  return {
    responsive: false,
    layout: { padding: { top: 8, right: 16, bottom: 4, left: 4 } },
    interaction: { intersect: false },
    plugins: {
      title: {
        display: Boolean(titleText),
        text: titleText,
        color: TITLE,
        font: { size: 15, weight: "bold" },
        padding: { bottom: 12 }
      },
      legend: {
        display: true,
        position: "top",
        align: "end",
        labels: {
          color: TEXT,
          usePointStyle: true,
          pointStyle: "line",
          boxWidth: 24,
          font: { size: 11 }
        }
      }
    },
    scales: {
      x: {
        grid: { color: GRID, drawBorder: false },
        ticks: { color: TEXT, maxTicksLimit: 10, font: { size: 10 }, maxRotation: 0 }
      },
      y: {
        beginAtZero: true,
        grid: { color: GRID, drawBorder: false },
        ticks: { color: TEXT, precision: 0, font: { size: 10 } }
      }
    }
  };
}

function toUrl(chartConfig, { width = 760, height = 320 } = {}) {
  const encoded = encodeURIComponent(JSON.stringify(chartConfig));
  return `${QUICKCHART_BASE}?v=4&w=${width}&h=${height}&devicePixelRatio=2&bkg=${encodeURIComponent(BACKGROUND)}&c=${encoded}`;
}

/**
 * Verlaufs-Diagramm: gefüllte, geglättete Kurve für den Durchschnitt,
 * dünne Linie für den Peak und eine gestrichelte Kapazitätslinie.
 */
export function buildPlayerHistoryChartUrl(points, {
  color = "#5865f2",
  title = "Spielerverlauf",
  targetPoints = 110,
  showPeak = true,
  showCapacity = true
} = {}) {
  const data = downsample(points || [], targetPoints);
  if (data.length < 2) {
    return "";
  }

  const span = data.at(-1).at - data[0].at;
  const labels = data.map((point) => formatTimeLabel(point.at, span));
  const capacity = Math.max(...data.map((point) => Number(point.maxPlayers || 0)));

  const datasets = [
    {
      label: "Ø Spieler",
      data: data.map((point) => Number(point.players || 0)),
      borderColor: color,
      borderWidth: 2.5,
      pointRadius: 0,
      pointHoverRadius: 0,
      tension: 0.35,
      fill: true,
      backgroundColor: `getGradientFillHelper('vertical', ['${hexToRgba(color, 0.45)}', '${hexToRgba(color, 0.02)}'])`
    }
  ];

  if (showPeak) {
    datasets.push({
      label: "Peak",
      data: data.map((point) => Number(point.peak || 0)),
      borderColor: hexToRgba("#ffffff", 0.45),
      borderWidth: 1.2,
      pointRadius: 0,
      tension: 0.35,
      fill: false
    });
  }

  if (showCapacity && capacity > 0) {
    datasets.push({
      label: `Slots (${capacity})`,
      data: data.map(() => capacity),
      borderColor: "rgba(237, 66, 69, 0.55)",
      borderWidth: 1,
      borderDash: [6, 6],
      pointRadius: 0,
      fill: false
    });
  }

  return toUrl({ type: "line", data: { labels, datasets }, options: baseOptions(title) });
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
  options.plugins.legend.display = false;

  return toUrl({
    type: "bar",
    data: {
      labels: hourProfile.map((entry) => `${String(entry.hour).padStart(2, "0")}`),
      datasets: [
        {
          label: "Ø Spieler",
          data: hourProfile.map((entry) => entry.average),
          backgroundColor: hexToRgba(color, 0.65),
          borderColor: color,
          borderWidth: 1,
          borderRadius: 4
        }
      ]
    },
    options
  }, { width: 760, height: 240 });
}

/**
 * Vergleichs-Diagramm über mehrere Server – eine Linie je Server.
 */
export function buildMultiServerChartUrl(series, { title = "Serververgleich", targetPoints = 90 } = {}) {
  const entries = (series || [])
    .map((entry) => ({ ...entry, points: downsample(entry.points || [], targetPoints) }))
    .filter((entry) => entry.points.length >= 2);

  if (entries.length === 0) {
    return "";
  }

  const reference = entries.reduce((best, entry) => (entry.points.length > best.points.length ? entry : best), entries[0]);
  const span = reference.points.at(-1).at - reference.points[0].at;

  return toUrl({
    type: "line",
    data: {
      labels: reference.points.map((point) => formatTimeLabel(point.at, span)),
      datasets: entries.map((entry) => ({
        label: entry.name,
        data: entry.points.map((point) => Number(point.players || 0)),
        borderColor: entry.color || "#5865f2",
        backgroundColor: hexToRgba(entry.color || "#5865f2", 0.12),
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.35,
        fill: entries.length === 1
      }))
    },
    options: baseOptions(title)
  });
}
