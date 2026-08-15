import { loadWatchlist, saveWatchlist, addSymbol, removeSymbol } from "./watchlist.js";
import { fetchQuotes, fetchChart, searchSymbols } from "./api.js";
import { renderSparkline } from "./chart.js";
import { initTooltips } from "./tooltip.js";

let watchlist = loadWatchlist();
let loadGeneration = 0;

const gridEl = document.getElementById("watchlist-grid");
const searchInputEl = document.getElementById("search-input");
const searchButtonEl = document.getElementById("search-button");
const searchResultsEl = document.getElementById("search-results");
const refreshButtonEl = document.getElementById("refresh-button");
const pageBannerEl = document.getElementById("page-banner");

function cardId(symbol) {
  return `card-${symbol.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

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

function renderGrid() {
  gridEl.innerHTML = "";
  for (const item of watchlist) {
    const card = document.createElement("article");
    card.className = "card";
    card.id = cardId(item.symbol);
    card.innerHTML = `
      <div class="card-header">
        <div>
          <div class="card-title">${escapeHtml(item.name)}</div>
          <div class="card-symbol">${escapeHtml(item.symbol)}</div>
        </div>
        <button class="card-remove" data-symbol="${escapeHtml(item.symbol)}" aria-label="削除">×</button>
      </div>
      <div class="card-body">読み込み中...</div>
    `;
    gridEl.appendChild(card);
  }

  gridEl.querySelectorAll(".card-remove").forEach((button) => {
    button.addEventListener("click", () => {
      watchlist = removeSymbol(watchlist, button.dataset.symbol);
      saveWatchlist(watchlist);
      renderGrid();
      loadData();
    });
  });
}

function renderCardBody(symbol, quote, points) {
  const card = document.getElementById(cardId(symbol));
  if (!card) return;
  const body = card.querySelector(".card-body");

  if (!quote || quote.error) {
    body.innerHTML = `
      <div class="card-error">
        取得できませんでした
        <button class="retry-button" data-symbol="${escapeHtml(symbol)}">再試行</button>
      </div>
    `;
    body.querySelector(".retry-button").addEventListener("click", () => {
      loadData();
    });
    return;
  }

  const changeValue = quote.change ?? 0;
  const changeClass = changeValue >= 0 ? "positive" : "negative";
  const changeSign = changeValue >= 0 ? "+" : "";

  body.innerHTML = `
    <div class="card-price">
      ${formatNumber(quote.price)}
      <button class="tooltip-icon" data-term="previous-close" aria-label="前日比とは">?</button>
    </div>
    <div class="card-change ${changeClass}">
      ${changeSign}${formatNumber(quote.change)} (${changeSign}${formatNumber(quote.changePercent)}%)
    </div>
    <div class="card-chart"></div>
  `;

  const chartContainer = body.querySelector(".card-chart");
  if (points && points.length > 0) {
    renderSparkline(chartContainer, points);
  }

  initTooltips(body);
}

async function refreshCard(item, generation, quote) {
  try {
    let points = [];
    try {
      const chart = await fetchChart(item.symbol, "3mo", "1d");
      points = chart.points;
    } catch {
      points = [];
    }

    if (generation !== loadGeneration) return true;

    renderCardBody(item.symbol, quote, points);
    return !quote.error;
  } catch (err) {
    if (generation !== loadGeneration) return false;
    renderCardBody(item.symbol, { symbol: item.symbol, error: true, message: err.message }, []);
    return false;
  }
}

async function loadData() {
  if (watchlist.length === 0) {
    pageBannerEl.hidden = true;
    return;
  }

  loadGeneration += 1;
  const generation = loadGeneration;

  let quotesBySymbol;
  try {
    const quotesResponse = await fetchQuotes(watchlist.map((item) => item.symbol));
    quotesBySymbol = new Map(quotesResponse.quotes.map((q) => [q.symbol, q]));
  } catch (err) {
    if (generation !== loadGeneration) return;
    for (const item of watchlist) {
      renderCardBody(item.symbol, { symbol: item.symbol, error: true, message: err.message }, []);
    }
    pageBannerEl.hidden = false;
    return;
  }

  if (generation !== loadGeneration) return;

  const results = await Promise.all(
    watchlist.map((item) => {
      const quote = quotesBySymbol.get(item.symbol) || { symbol: item.symbol, error: true };
      return refreshCard(item, generation, quote);
    })
  );
  if (generation !== loadGeneration) return;

  const allFailed = results.every((ok) => !ok);
  pageBannerEl.hidden = !allFailed;
}

async function handleSearch() {
  const query = searchInputEl.value.trim();
  searchResultsEl.innerHTML = "";
  if (!query) return;

  let results;
  try {
    const response = await searchSymbols(query);
    results = response.results;
  } catch {
    searchResultsEl.innerHTML = "<li>検索に失敗しました</li>";
    return;
  }

  if (results.length === 0) {
    searchResultsEl.innerHTML = "<li>該当する銘柄が見つかりませんでした</li>";
    return;
  }

  for (const result of results) {
    const li = document.createElement("li");
    li.innerHTML = `<span>${escapeHtml(result.name)} (${escapeHtml(result.symbol)})</span><span>${escapeHtml(result.exchange)}</span>`;
    li.addEventListener("click", () => {
      watchlist = addSymbol(watchlist, { symbol: result.symbol, name: result.name });
      saveWatchlist(watchlist);
      searchResultsEl.innerHTML = "";
      searchInputEl.value = "";
      renderGrid();
      loadData();
    });
    searchResultsEl.appendChild(li);
  }
}

searchButtonEl.addEventListener("click", handleSearch);
searchInputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") handleSearch();
});
refreshButtonEl.addEventListener("click", loadData);

renderGrid();
loadData();
