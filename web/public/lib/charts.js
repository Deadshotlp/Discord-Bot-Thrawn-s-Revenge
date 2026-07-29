const SVG_NS = "http://www.w3.org/2000/svg";

let gradientCounter = 0;

function svg(tag, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== null && value !== undefined) {
      element.setAttribute(key, String(value));
    }
  }

  return element;
}

function niceCeil(value) {
  if (value <= 5) {
    return 5;
  }

  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

// Catmull-Rom → kubische Bézier: weiche Kurve ohne Überschwingen an Extremwerten.
function smoothPath(points) {
  if (points.length < 2) {
    return "";
  }

  let path = `M ${points[0][0]} ${points[0][1]}`;

  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(points.length - 1, index + 2)];

    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;

    path += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }

  return path;
}

function formatAxisTime(timestamp, spanMs) {
  const date = new Date(timestamp);

  if (spanMs <= 36 * 3600 * 1000) {
    return new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(date);
  }

  if (spanMs <= 14 * 86400 * 1000) {
    return new Intl.DateTimeFormat("de-DE", { weekday: "short", hour: "2-digit" }).format(date);
  }

  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" }).format(date);
}

/**
 * Flächen-/Liniendiagramm für Spielerverläufe.
 * Zeigt Durchschnitt als gefüllte Kurve, optional den Peak als feine Linie,
 * die Slot-Kapazität als gestrichelte Referenz und markiert Offline-Phasen.
 */
export function lineChart(series, {
  width = 900,
  height = 260,
  color = "#5865f2",
  showPeak = true,
  showCapacity = true,
  yLabel = "Spieler"
} = {}) {
  const points = (series || []).filter((point) => Number.isFinite(point.at));
  const wrapper = document.createElement("div");
  wrapper.className = "chart";

  if (points.length < 2) {
    wrapper.innerHTML = '<p class="muted chart-empty">Noch nicht genug Messdaten.</p>';
    return wrapper;
  }

  const padding = { top: 16, right: 16, bottom: 26, left: 38 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const minAt = points[0].at;
  const maxAt = points.at(-1).at;
  const spanMs = Math.max(1, maxAt - minAt);

  const capacity = showCapacity
    ? Math.max(...points.map((point) => Number(point.maxPlayers || 0)))
    : 0;

  const dataMax = Math.max(
    1,
    ...points.map((point) => Math.max(Number(point.players || 0), showPeak ? Number(point.peak || 0) : 0))
  );
  const yMax = niceCeil(Math.max(dataMax, capacity > 0 && capacity <= dataMax * 2.5 ? capacity : dataMax));

  const xOf = (at) => padding.left + ((at - minAt) / spanMs) * innerWidth;
  const yOf = (value) => padding.top + innerHeight - (Math.min(value, yMax) / yMax) * innerHeight;

  const root = svg("svg", {
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: "none",
    class: "chart-svg",
    role: "img"
  });

  gradientCounter += 1;
  const gradientId = `chart-gradient-${gradientCounter}`;
  const defs = svg("defs");
  const gradient = svg("linearGradient", { id: gradientId, x1: 0, y1: 0, x2: 0, y2: 1 });
  gradient.append(
    svg("stop", { offset: "0%", "stop-color": color, "stop-opacity": "0.45" }),
    svg("stop", { offset: "100%", "stop-color": color, "stop-opacity": "0.02" })
  );
  defs.append(gradient);
  root.append(defs);

  // Rasterlinien + Y-Achse
  const gridSteps = 4;
  for (let step = 0; step <= gridSteps; step += 1) {
    const value = (yMax / gridSteps) * step;
    const y = yOf(value);

    root.append(svg("line", {
      x1: padding.left,
      x2: width - padding.right,
      y1: y,
      y2: y,
      class: "chart-grid"
    }));

    const label = svg("text", { x: padding.left - 8, y: y + 4, class: "chart-axis", "text-anchor": "end" });
    label.textContent = String(Math.round(value));
    root.append(label);
  }

  // Offline-Phasen hinterlegen
  let offlineStart = null;
  for (const point of points) {
    if (point.online === false && offlineStart === null) {
      offlineStart = point.at;
    } else if (point.online !== false && offlineStart !== null) {
      root.append(svg("rect", {
        x: xOf(offlineStart),
        y: padding.top,
        width: Math.max(1, xOf(point.at) - xOf(offlineStart)),
        height: innerHeight,
        class: "chart-offline"
      }));
      offlineStart = null;
    }
  }

  if (offlineStart !== null) {
    root.append(svg("rect", {
      x: xOf(offlineStart),
      y: padding.top,
      width: Math.max(1, xOf(maxAt) - xOf(offlineStart)),
      height: innerHeight,
      class: "chart-offline"
    }));
  }

  const averagePoints = points.map((point) => [xOf(point.at), yOf(Number(point.players || 0))]);
  const linePath = smoothPath(averagePoints);

  root.append(svg("path", {
    d: `${linePath} L ${averagePoints.at(-1)[0]} ${padding.top + innerHeight} L ${averagePoints[0][0]} ${padding.top + innerHeight} Z`,
    fill: `url(#${gradientId})`,
    stroke: "none"
  }));

  if (showPeak && points.some((point) => Number(point.peak || 0) > Number(point.players || 0))) {
    root.append(svg("path", {
      d: smoothPath(points.map((point) => [xOf(point.at), yOf(Number(point.peak || 0))])),
      class: "chart-peak",
      fill: "none"
    }));
  }

  if (capacity > 0 && capacity <= yMax) {
    root.append(svg("line", {
      x1: padding.left,
      x2: width - padding.right,
      y1: yOf(capacity),
      y2: yOf(capacity),
      class: "chart-capacity"
    }));
  }

  root.append(svg("path", { d: linePath, stroke: color, class: "chart-line", fill: "none" }));

  // X-Achse
  const tickCount = Math.min(6, points.length);
  for (let index = 0; index < tickCount; index += 1) {
    const point = points[Math.round((index / (tickCount - 1 || 1)) * (points.length - 1))];
    const label = svg("text", {
      x: xOf(point.at),
      y: height - 8,
      class: "chart-axis",
      "text-anchor": index === 0 ? "start" : index === tickCount - 1 ? "end" : "middle"
    });
    label.textContent = formatAxisTime(point.at, spanMs);
    root.append(label);
  }

  // Hover-Marker
  const marker = svg("circle", { r: 4, class: "chart-marker", cx: -10, cy: -10 });
  const guide = svg("line", { class: "chart-guide", y1: padding.top, y2: padding.top + innerHeight, x1: -10, x2: -10 });
  root.append(guide, marker);

  const tooltip = document.createElement("div");
  tooltip.className = "chart-tooltip";
  wrapper.append(root, tooltip);

  root.addEventListener("pointerleave", () => {
    tooltip.classList.remove("visible");
    marker.setAttribute("cx", "-10");
    guide.setAttribute("x1", "-10");
    guide.setAttribute("x2", "-10");
  });

  root.addEventListener("pointermove", (event) => {
    const rect = root.getBoundingClientRect();
    const relative = ((event.clientX - rect.left) / rect.width) * width;
    const targetAt = minAt + ((relative - padding.left) / innerWidth) * spanMs;

    let closest = points[0];
    for (const point of points) {
      if (Math.abs(point.at - targetAt) < Math.abs(closest.at - targetAt)) {
        closest = point;
      }
    }

    const cx = xOf(closest.at);
    const cy = yOf(Number(closest.players || 0));

    marker.setAttribute("cx", cx);
    marker.setAttribute("cy", cy);
    marker.setAttribute("fill", color);
    guide.setAttribute("x1", cx);
    guide.setAttribute("x2", cx);

    tooltip.innerHTML = [
      `<strong>${Number(closest.players || 0)}</strong> ${yLabel}`,
      closest.peak !== undefined && closest.peak !== closest.players ? `Peak ${closest.peak}` : "",
      closest.map ? closest.map : "",
      new Intl.DateTimeFormat("de-DE", {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
      }).format(new Date(closest.at))
    ].filter(Boolean).join("<br>");

    tooltip.style.left = `${(cx / width) * 100}%`;
    tooltip.classList.add("visible");
  });

  return wrapper;
}

/**
 * Balkendiagramm für Profile (Uhrzeit, Wochentag, Tickets pro Tag).
 */
export function barChart(bars, { width = 900, height = 200, color = "#5865f2", valueSuffix = "" } = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "chart";

  const data = (bars || []).filter((bar) => bar && Number.isFinite(Number(bar.value)));
  if (data.length === 0 || data.every((bar) => Number(bar.value) === 0)) {
    wrapper.innerHTML = '<p class="muted chart-empty">Noch keine Daten.</p>';
    return wrapper;
  }

  const padding = { top: 12, right: 12, bottom: 24, left: 34 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const yMax = niceCeil(Math.max(...data.map((bar) => Number(bar.value))));
  const slot = innerWidth / data.length;
  const barWidth = Math.max(2, slot * 0.62);

  const root = svg("svg", { viewBox: `0 0 ${width} ${height}`, class: "chart-svg", preserveAspectRatio: "none" });

  for (let step = 0; step <= 3; step += 1) {
    const value = (yMax / 3) * step;
    const y = padding.top + innerHeight - (value / yMax) * innerHeight;
    root.append(svg("line", { x1: padding.left, x2: width - padding.right, y1: y, y2: y, class: "chart-grid" }));

    const label = svg("text", { x: padding.left - 8, y: y + 4, class: "chart-axis", "text-anchor": "end" });
    label.textContent = String(Math.round(value * 10) / 10);
    root.append(label);
  }

  data.forEach((bar, index) => {
    const value = Number(bar.value);
    const barHeight = (value / yMax) * innerHeight;
    const x = padding.left + index * slot + (slot - barWidth) / 2;

    const rect = svg("rect", {
      x,
      y: padding.top + innerHeight - barHeight,
      width: barWidth,
      height: Math.max(1, barHeight),
      rx: Math.min(4, barWidth / 2),
      fill: bar.color || color,
      class: "chart-bar"
    });

    const title = svg("title");
    title.textContent = `${bar.label}: ${value}${valueSuffix}`;
    rect.append(title);
    root.append(rect);

    if (data.length <= 32) {
      const label = svg("text", {
        x: x + barWidth / 2,
        y: height - 8,
        class: "chart-axis",
        "text-anchor": "middle"
      });
      label.textContent = bar.label;
      root.append(label);
    }
  });

  wrapper.append(root);
  return wrapper;
}

/**
 * Gantt-artige Zeitleiste für Abmeldungen.
 */
export function timeline(entries, { days = 21, startDate = new Date() } = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "timeline";

  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const dayMs = 86400000;

  const header = document.createElement("div");
  header.className = "timeline-header";
  header.style.gridTemplateColumns = `160px repeat(${days}, 1fr)`;
  header.append(document.createElement("div"));

  for (let index = 0; index < days; index += 1) {
    const date = new Date(start.getTime() + index * dayMs);
    const cell = document.createElement("div");
    cell.className = `timeline-day${date.getDay() === 0 || date.getDay() === 6 ? " weekend" : ""}`;
    cell.textContent = date.getDate();
    cell.title = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "long" }).format(date);
    header.append(cell);
  }

  wrapper.append(header);

  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "timeline-row";
    row.style.gridTemplateColumns = `160px repeat(${days}, 1fr)`;

    const label = document.createElement("div");
    label.className = "timeline-label";
    label.textContent = entry.label;
    label.title = entry.label;
    row.append(label);

    const track = document.createElement("div");
    track.className = "timeline-track";
    track.style.gridColumn = `2 / span ${days}`;
    row.append(track);

    for (const span of entry.spans) {
      const spanStart = new Date(`${span.startsOn}T00:00:00`).getTime();
      const spanEnd = new Date(`${span.endsOn}T00:00:00`).getTime();
      const offset = Math.max(0, Math.round((spanStart - start.getTime()) / dayMs));
      const length = Math.max(1, Math.round((spanEnd - Math.max(spanStart, start.getTime())) / dayMs) + 1);

      if (offset >= days) {
        continue;
      }

      const bar = document.createElement("div");
      bar.className = `timeline-bar tone-${span.tone || "default"}`;
      bar.style.left = `${(offset / days) * 100}%`;
      bar.style.width = `${(Math.min(length, days - offset) / days) * 100}%`;
      bar.textContent = span.text || "";
      bar.title = span.title || span.text || "";
      track.append(bar);
    }

    wrapper.append(row);
  }

  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Keine Abmeldungen im Zeitraum.";
    wrapper.append(empty);
  }

  return wrapper;
}
