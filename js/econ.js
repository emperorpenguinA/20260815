import { fetchEconIndicators } from "./api.js";
import { renderSparkline } from "./chart.js";
import { initTooltips } from "./tooltip.js";

const TOOLTIP_TERM_BY_ID = {
  "jp-cpi": "cpi",
  "jp-ppi-domestic": "ppi",
  "jp-ppi-export": "export-price-index",
  "jp-ppi-import": "import-price-index",
  "us-cpi": "cpi",
  "us-ppi-domestic": "ppi",
  "us-ppi-export": "export-price-index",
  "us-ppi-import": "import-price-index",
};

const CARD_ORDER = [
  "jp-cpi", "us-cpi",
  "jp-ppi-domestic", "us-ppi-domestic",
  "jp-ppi-export", "us-ppi-export",
  "jp-ppi-import", "us-ppi-import",
];

const gridEl = document.getElementById("econ-grid");

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }
  return value.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderIndicatorCard(indicator) {
  const card = document.createElement("article");
  card.className = "card";
  card.id = `econ-${indicator.id}`;

  if (indicator.error) {
    card.innerHTML = `
      <div class="card-header">
        <div>
          <div class="card-title">${escapeHtml(indicator.label)}</div>
          <div class="card-symbol">${escapeHtml(indicator.country)}</div>
        </div>
      </div>
      <div class="card-error">
        取得できませんでした
        <button class="retry-button">再試行</button>
      </div>
    `;
    card.querySelector(".retry-button").addEventListener("click", loadEconIndicators);
    return card;
  }

  const changeValue = indicator.yoyPercent;
  const changeClass = typeof changeValue === "number" ? (changeValue >= 0 ? "positive" : "negative") : "";
  const changeSign = typeof changeValue === "number" && changeValue >= 0 ? "+" : "";
  const termId = TOOLTIP_TERM_BY_ID[indicator.id] || "cpi";
  const yoyText = indicator.yoyPercent === null ? "-" : `${changeSign}${formatNumber(indicator.yoyPercent)}%`;

  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">${escapeHtml(indicator.label)}</div>
        <div class="card-symbol">${escapeHtml(indicator.country)}</div>
      </div>
    </div>
    <div class="card-price ${changeClass}">
      ${yoyText}
      <button class="tooltip-icon" data-term="${termId}" aria-label="${escapeHtml(indicator.label)}とは">?</button>
    </div>
    <div class="card-symbol">前年同月比・${escapeHtml(indicator.latestDate || "-")}時点</div>
    <div class="card-chart"></div>
  `;

  const chartContainer = card.querySelector(".card-chart");
  const points = (indicator.points || []).map((p) => ({ date: p.date, close: p.value }));
  if (points.length > 0) {
    renderSparkline(chartContainer, points);
  }

  initTooltips(card);
  return card;
}

async function loadEconIndicators() {
  gridEl.innerHTML = "読み込み中...";

  let response;
  try {
    response = await fetchEconIndicators();
  } catch {
    gridEl.innerHTML = `<div class="card-error">経済指標を取得できませんでした</div>`;
    return;
  }

  gridEl.innerHTML = "";
  const indicatorsById = new Map(response.indicators.map((indicator) => [indicator.id, indicator]));
  for (const id of CARD_ORDER) {
    const indicator = indicatorsById.get(id);
    if (indicator) {
      gridEl.appendChild(renderIndicatorCard(indicator));
    }
  }
}

loadEconIndicators();
