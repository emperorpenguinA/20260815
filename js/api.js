import { WORKER_BASE_URL } from "./config.js";

async function getJson(path) {
  const res = await fetch(`${WORKER_BASE_URL}${path}`);
  if (!res.ok) {
    throw new Error(`APIエラー: ${res.status}`);
  }
  return res.json();
}

export function fetchQuotes(symbols) {
  const query = encodeURIComponent(symbols.join(","));
  return getJson(`/api/quote?symbols=${query}`);
}

export function fetchChart(symbol, range = "3mo", interval = "1d") {
  const query = `symbol=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`;
  return getJson(`/api/chart?${query}`);
}

export function searchSymbols(query) {
  return getJson(`/api/search?q=${encodeURIComponent(query)}`);
}

export function fetchEconIndicators(months) {
  const query = months ? `?months=${encodeURIComponent(months)}` : "";
  return getJson(`/api/econ${query}`);
}
