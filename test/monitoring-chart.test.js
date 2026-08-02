import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_COMPARISON_SERIES,
  MAX_IMAGE_URL_LENGTH,
  buildHourProfileChartUrl,
  buildMultiServerChartUrl,
  buildPlayerHistoryChartUrl
} from "../src/modules/monitoring/services/chart.js";

const T0 = Date.UTC(2026, 0, 15, 12, 0, 0);

function series(count, stepMs, { maxPlayers = 64 } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    at: T0 - (count - 1 - index) * stepMs,
    players: 20 + 18 * Math.sin(index / 9),
    peak: 28 + 18 * Math.sin(index / 9),
    maxPlayers
  }));
}

function configOf(url) {
  return JSON.parse(decodeURIComponent(url.split("&c=")[1]));
}

test("Verlaufs-URL bleibt in jedem Zeitraum unter Discords Limit", () => {
  const ranges = [
    ["24 Stunden roh", series(2880, 30 * 1000)],
    ["7 Tage stündlich", series(168, 60 * 60 * 1000)],
    ["30 Tage täglich", series(30, 24 * 60 * 60 * 1000)]
  ];

  for (const [label, points] of ranges) {
    const url = buildPlayerHistoryChartUrl(points, { title: `Spielerverlauf · ${label}` });

    assert.ok(url, `${label}: keine URL erzeugt`);
    assert.ok(
      url.length <= MAX_IMAGE_URL_LENGTH,
      `${label}: ${url.length} Zeichen überschreiten ${MAX_IMAGE_URL_LENGTH}`
    );
  }
});

test("überlange Titel führen nicht zu einer abgewiesenen URL", () => {
  const url = buildPlayerHistoryChartUrl(series(2880, 30 * 1000), {
    title: "Spielerverlauf".padEnd(300, "x")
  });

  assert.ok(url.length <= MAX_IMAGE_URL_LENGTH);
});

test("die Auflösung wird nur so weit reduziert wie nötig", () => {
  const url = buildPlayerHistoryChartUrl(series(2880, 30 * 1000), { title: "Spielerverlauf" });
  const config = configOf(url);

  assert.ok(
    config.data.datasets[0].data.length >= 30,
    `nur ${config.data.datasets[0].data.length} Punkte im Diagramm`
  );
  assert.equal(config.data.labels.length, config.data.datasets[0].data.length);
});

test("Kapazität steht im Titel statt als eigene Datenreihe", () => {
  const config = configOf(buildPlayerHistoryChartUrl(series(120, 60 * 1000, { maxPlayers: 64 }), {
    title: "Spielerverlauf"
  }));

  assert.match(config.options.plugins.title.text, /64 Slots/);
  assert.deepEqual(config.data.datasets.map((dataset) => dataset.label), ["Ø Spieler", "Peak"]);
});

test("Farbwerte kommen ohne Kommas aus, damit die URL kurz bleibt", () => {
  const config = configOf(buildPlayerHistoryChartUrl(series(60, 60 * 1000), { color: "#57f287" }));

  assert.equal(config.data.datasets[0].backgroundColor, "#57f28729");
  assert.ok(!JSON.stringify(config.options).includes("rgba("));
});

test("zu wenige Messpunkte ergeben kein Diagramm", () => {
  assert.equal(buildPlayerHistoryChartUrl([], { title: "X" }), "");
  assert.equal(buildPlayerHistoryChartUrl(series(1, 1000), { title: "X" }), "");
});

test("Stundenprofil bleibt unter dem Limit und entfällt ohne Daten", () => {
  const profile = Array.from({ length: 24 }, (_, hour) => ({ hour, average: 5 + hour / 3 }));
  const url = buildHourProfileChartUrl(profile, { title: "Aktivität nach Uhrzeit (14 Tage)" });

  assert.ok(url.length > 0 && url.length <= MAX_IMAGE_URL_LENGTH);
  assert.equal(
    buildHourProfileChartUrl(Array.from({ length: 24 }, (_, hour) => ({ hour, average: 0 }))),
    ""
  );
});

test("Serververgleich passt auch mit vielen Servern in eine URL", () => {
  for (const count of [2, 6, 10, 25]) {
    const { url, shown } = buildMultiServerChartUrl(
      Array.from({ length: count }, (_, index) => ({
        name: `Servername ${index + 1}`,
        color: "#5865f2",
        points: series(168, 60 * 60 * 1000)
      })),
      { title: "Serververgleich · 7 Tage" }
    );

    assert.ok(url, `${count} Server: keine URL erzeugt`);
    assert.ok(url.length <= MAX_IMAGE_URL_LENGTH, `${count} Server: ${url.length} Zeichen`);
    assert.ok(shown >= 1 && shown <= Math.min(count, MAX_COMPARISON_SERIES), `${count} Server: shown=${shown}`);
    assert.equal(configOf(url).data.datasets.length, shown);
  }
});

test("auch sehr lange Servernamen liefern noch ein Vergleichsbild", () => {
  const { url, shown } = buildMultiServerChartUrl(
    Array.from({ length: 6 }, (_, index) => ({
      name: `Sehr langer Servername für Test Nummer ${index + 1}`.padEnd(90, "x"),
      color: "#5865f2",
      points: series(168, 60 * 60 * 1000)
    })),
    { title: "Serververgleich · 7 Tage" }
  );

  assert.ok(url, "keine URL trotz vorhandener Messdaten");
  assert.ok(url.length <= MAX_IMAGE_URL_LENGTH);
  assert.ok(shown >= 1);
});
