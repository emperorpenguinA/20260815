const SVG_NS = "http://www.w3.org/2000/svg";
const WIDTH = 240;
const HEIGHT = 60;
const PADDING = 4;
const MARKER_RADIUS = 6;

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

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", pointsToPath(points, width, height));

  const isUp = points.at(-1).close >= points[0].close;
  path.setAttribute("stroke", isUp ? "var(--color-positive)" : "var(--color-negative)");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke-width", "2");

  svg.appendChild(path);

  const coords = pointsToCoordinates(points, width, height);
  for (const coord of coords) {
    const marker = document.createElementNS(SVG_NS, "circle");
    marker.setAttribute("cx", coord.x.toFixed(2));
    marker.setAttribute("cy", coord.y.toFixed(2));
    marker.setAttribute("r", String(MARKER_RADIUS));
    marker.setAttribute("fill", "transparent");

    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = `${coord.date}: ${formatMarkerValue(coord.close)}`;
    marker.appendChild(title);

    svg.appendChild(marker);
  }

  container.appendChild(svg);
}
