import { fetchPpp } from "./api.js";
import { renderComparisonChart } from "./chart.js";
import { initTooltips } from "./tooltip.js";

const gridEl = document.getElementById("ppp-grid");
const periodSelectorEl = document.getElementById("ppp-period-selector");
const jpyGridEl = document.getElementById("ppp-jpy-grid");

let selectedMonths = 36;

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

function renderPppCard(indicator, subjectCurrency, counterCurrency) {
  const card = document.createElement("article");
  card.className = "card";
  card.id = `ppp-${indicator.pair.replace("/", "-")}`;

  if (indicator.error) {
    card.innerHTML = `
      <div class="card-header">
        <div>
          <div class="card-title">${escapeHtml(indicator.pair)}</div>
        </div>
      </div>
      <div class="card-error">
        取得できませんでした
        <button class="retry-button">再試行</button>
      </div>
    `;
    card.querySelector(".retry-button").addEventListener("click", loadPppIndicators);
    return card;
  }

  const changeValue = indicator.overUndervaluedPercent;
  const changeClass = typeof changeValue === "number" ? (changeValue >= 0 ? "positive" : "negative") : "";
  const direction = typeof changeValue === "number" ? (changeValue >= 0 ? "割安" : "割高") : null;
  const valuationText =
    direction === null
      ? "-"
      : counterCurrency
        ? `${subjectCurrency}は${counterCurrency}に対し理論値より${formatNumber(Math.abs(changeValue))}%${direction}`
        : `${subjectCurrency}は理論値より${formatNumber(Math.abs(changeValue))}%${direction}`;

  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">${escapeHtml(indicator.pair)}</div>
      </div>
    </div>
    <div class="card-chart"></div>
    <div class="card-chart-caption">
      実勢 ${formatNumber(indicator.latestActual)} / PPP ${formatNumber(indicator.latestPpp)}(${indicator.pppYear}年時点)
    </div>
    <div class="card-price ${changeClass}">
      ${valuationText}
      <button class="tooltip-icon" data-term="ppp" aria-label="購買力平価(PPP)とは">?</button>
    </div>
    ${indicator.note ? `<div class="card-note">${escapeHtml(indicator.note)}</div>` : ""}
  `;

  const chartContainer = card.querySelector(".card-chart");
  if (indicator.points && indicator.points.length > 0) {
    renderComparisonChart(chartContainer, indicator.points);
  }

  initTooltips(card);
  return card;
}

async function loadPppIndicators() {
  gridEl.innerHTML = "読み込み中...";
  if (jpyGridEl) jpyGridEl.innerHTML = "読み込み中...";

  let response;
  try {
    response = await fetchPpp(selectedMonths);
  } catch {
    gridEl.innerHTML = `<div class="card-error">購買力平価を取得できませんでした</div>`;
    if (jpyGridEl) jpyGridEl.innerHTML = "";
    return;
  }

  gridEl.innerHTML = "";
  for (const indicator of response.indicators) {
    gridEl.appendChild(renderPppCard(indicator, indicator.currency, null));
  }

  if (jpyGridEl) {
    jpyGridEl.innerHTML = "";
    for (const indicator of response.crossIndicators ?? []) {
      jpyGridEl.appendChild(renderPppCard(indicator, "JPY", indicator.currency));
    }
  }
}

function setupPeriodSelector() {
  const buttons = periodSelectorEl.querySelectorAll("button");
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const months = Number(button.dataset.months);
      if (months === selectedMonths) return;
      selectedMonths = months;
      buttons.forEach((b) => b.classList.toggle("active", b === button));
      loadPppIndicators();
    });
  });
}

setupPeriodSelector();
loadPppIndicators();
