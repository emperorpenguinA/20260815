const SVG_NS = "http://www.w3.org/2000/svg";
const WIDTH = 240;
const HEIGHT = 60;
const PADDING = 4;
const INDICATOR_RADIUS = 3;

export function pointsToCoordinates(points, width = WIDTH, height = HEIGHT, padding = PADDING) {
  if (!points || points.length === 0) return [];

  const closes = points.map((p) => p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;

  const stepX = (width - padding * 2) / Math.max(points.length - 1, 1);

  return points.map((point, index) => ({
    x: padding + index * stepX,
    y: height - padding - ((point.close - min) / range) * (height - padding * 2),
    date: point.date,
    close: point.close,
  }));
}

export function pointsToPath(points, width = WIDTH, height = HEIGHT, padding = PADDING) {
  const coords = pointsToCoordinates(points, width, height, padding);

  return coords
    .map((coord, index) => `${index === 0 ? "M" : "L"}${coord.x.toFixed(2)},${coord.y.toFixed(2)}`)
    .join(" ");
}

function formatMarkerValue(value) {
  return value.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
}

// Shared across every rendered sparkline: only one point-tooltip is ever
// shown at a time, and only one "tap outside closes it" listener is ever
// registered, no matter how many times renderSparkline runs (once per
// card, and again on every refresh).
let sharedTooltipEl = null;
let activeSvg = null;

function ensureTooltipEl() {
  if (sharedTooltipEl) return sharedTooltipEl;

  sharedTooltipEl = document.createElement("div");
  sharedTooltipEl.className = "chart-point-tooltip";
  sharedTooltipEl.hidden = true;
  document.body.appendChild(sharedTooltipEl);

  document.addEventListener("pointerdown", (event) => {
    if (activeSvg && !activeSvg.contains(event.target)) {
      hideTooltip();
    }
  });

  return sharedTooltipEl;
}

function hideTooltip() {
  if (activeSvg) {
    const indicator = activeSvg.querySelector(".chart-indicator");
    if (indicator) indicator.style.display = "none";
  }
  if (sharedTooltipEl) sharedTooltipEl.hidden = true;
  activeSvg = null;
}

function nearestCoord(coords, svg, clientX, logicalWidth) {
  const rect = svg.getBoundingClientRect();
  const scale = rect.width === 0 ? 1 : logicalWidth / rect.width;
  const logicalX = (clientX - rect.left) * scale;

  let nearest = coords[0];
  let minDistance = Math.abs(coords[0].x - logicalX);
  for (const coord of coords) {
    const distance = Math.abs(coord.x - logicalX);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = coord;
    }
  }
  return nearest;
}

function showPoint(svg, indicator, coord, logicalWidth, logicalHeight) {
  const tooltip = ensureTooltipEl();
  const rect = svg.getBoundingClientRect();
  const scaleX = logicalWidth === 0 ? 1 : rect.width / logicalWidth;
  const scaleY = logicalHeight === 0 ? 1 : rect.height / logicalHeight;

  indicator.setAttribute("cx", coord.x.toFixed(2));
  indicator.setAttribute("cy", coord.y.toFixed(2));
  indicator.style.display = "";

  tooltip.textContent = `${coord.date}: ${formatMarkerValue(coord.close)}`;
  tooltip.hidden = false;
  tooltip.style.left = `${rect.left + coord.x * scaleX}px`;
  tooltip.style.top = `${rect.top + coord.y * scaleY}px`;

  activeSvg = svg;
}

export function renderSparkline(container, points, width = WIDTH, height = HEIGHT) {
  container.innerHTML = "";
  if (!points || points.length === 0) {
    return;
  }

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", String(height));
  svg.setAttribute("preserveAspectRatio", "none");
  svg.style.touchAction = "pan-y";

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", pointsToPath(points, width, height));

  const isUp = points.at(-1).close >= points[0].close;
  path.setAttribute("stroke", isUp ? "var(--color-positive)" : "var(--color-negative)");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke-width", "2");

  const indicator = document.createElementNS(SVG_NS, "circle");
  indicator.setAttribute("class", "chart-indicator");
  indicator.setAttribute("r", String(INDICATOR_RADIUS));
  indicator.setAttribute("fill", "var(--color-accent)");
  indicator.style.display = "none";

  svg.appendChild(path);
  svg.appendChild(indicator);
  container.appendChild(svg);

  const coords = pointsToCoordinates(points, width, height);

  function handlePointerActivity(event) {
    const coord = nearestCoord(coords, svg, event.clientX, width);
    showPoint(svg, indicator, coord, width, height);
  }

  svg.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    svg.setPointerCapture(event.pointerId);
    handlePointerActivity(event);
  });
  svg.addEventListener("pointermove", handlePointerActivity);
  svg.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "mouse") {
      hideTooltip();
    }
  });
}

function pointsToDualCoordinates(points, width = WIDTH, height = HEIGHT, padding = PADDING) {
  if (!points || points.length === 0) return { actual: [], ppp: [] };

  const allValues = points.flatMap((p) => [p.actual, p.ppp]).filter((v) => typeof v === "number");
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;

  const stepX = (width - padding * 2) / Math.max(points.length - 1, 1);
  const toY = (value) => height - padding - ((value - min) / range) * (height - padding * 2);

  const actual = points.map((point, index) => ({
    x: padding + index * stepX,
    y: toY(point.actual),
    date: point.date,
    value: point.actual,
  }));
  const ppp = points.map((point, index) => ({
    x: padding + index * stepX,
    y: toY(point.ppp),
    date: point.date,
    value: point.ppp,
  }));

  return { actual, ppp };
}

function coordsToPath(coords) {
  return coords
    .map((coord, index) => `${index === 0 ? "M" : "L"}${coord.x.toFixed(2)},${coord.y.toFixed(2)}`)
    .join(" ");
}

function showComparisonPoint(svg, indicator, actualCoord, pppCoord, actualLabel, pppLabel, logicalWidth, logicalHeight) {
  const tooltip = ensureTooltipEl();
  const rect = svg.getBoundingClientRect();
  const scaleX = logicalWidth === 0 ? 1 : rect.width / logicalWidth;
  const scaleY = logicalHeight === 0 ? 1 : rect.height / logicalHeight;

  indicator.setAttribute("cx", actualCoord.x.toFixed(2));
  indicator.setAttribute("cy", actualCoord.y.toFixed(2));
  indicator.style.display = "";

  tooltip.textContent = `${actualCoord.date}: ${actualLabel} ${formatMarkerValue(actualCoord.value)} / ${pppLabel} ${formatMarkerValue(pppCoord.value)}`;
  tooltip.hidden = false;
  tooltip.style.left = `${rect.left + actualCoord.x * scaleX}px`;
  tooltip.style.top = `${rect.top + actualCoord.y * scaleY}px`;

  activeSvg = svg;
}

export function renderComparisonChart(container, points, options = {}) {
  const { width = WIDTH, height = HEIGHT, actualLabel = "実勢", pppLabel = "PPP" } = options;

  container.innerHTML = "";
  if (!points || points.length === 0) {
    return;
  }

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", String(height));
  svg.setAttribute("preserveAspectRatio", "none");
  svg.style.touchAction = "pan-y";

  const { actual: actualCoords, ppp: pppCoords } = pointsToDualCoordinates(points, width, height);

  const pppPath = document.createElementNS(SVG_NS, "path");
  pppPath.setAttribute("d", coordsToPath(pppCoords));
  pppPath.setAttribute("stroke", "var(--color-muted)");
  pppPath.setAttribute("fill", "none");
  pppPath.setAttribute("stroke-width", "2");
  pppPath.setAttribute("stroke-dasharray", "4 3");

  const actualPath = document.createElementNS(SVG_NS, "path");
  actualPath.setAttribute("d", coordsToPath(actualCoords));
  actualPath.setAttribute("stroke", "var(--color-accent)");
  actualPath.setAttribute("fill", "none");
  actualPath.setAttribute("stroke-width", "2");

  const indicator = document.createElementNS(SVG_NS, "circle");
  indicator.setAttribute("class", "chart-indicator");
  indicator.setAttribute("r", String(INDICATOR_RADIUS));
  indicator.setAttribute("fill", "var(--color-accent)");
  indicator.style.display = "none";

  svg.appendChild(pppPath);
  svg.appendChild(actualPath);
  svg.appendChild(indicator);
  container.appendChild(svg);

  function handlePointerActivity(event) {
    const nearestActual = nearestCoord(actualCoords, svg, event.clientX, width);
    const index = actualCoords.indexOf(nearestActual);
    const matchingPpp = pppCoords[index];
    showComparisonPoint(svg, indicator, nearestActual, matchingPpp, actualLabel, pppLabel, width, height);
  }

  svg.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    svg.setPointerCapture(event.pointerId);
    handlePointerActivity(event);
  });
  svg.addEventListener("pointermove", handlePointerActivity);
  svg.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "mouse") {
      hideTooltip();
    }
  });
}
