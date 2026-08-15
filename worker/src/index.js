import {
  fetchChart,
  fetchSearch,
  normalizeChart,
  normalizeSearch,
  fetchJapanSearchHtml,
  extractPreloadedState,
  normalizeJapanSearch,
} from "./yahoo.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === "/api/quote") {
      return handleQuote(url);
    }
    if (url.pathname === "/api/chart") {
      return handleChart(url);
    }
    if (url.pathname === "/api/search") {
      return handleSearch(url);
    }

    return jsonResponse({ error: true, message: "not found" }, 404);
  },
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

async function handleQuote(url) {
  const symbolsParam = url.searchParams.get("symbols") || "";
  const symbols = symbolsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (symbols.length === 0) {
    return jsonResponse({ error: true, message: "symbols is required" }, 400);
  }

  const quotes = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const raw = await fetchChart(symbol, "1d", "1d");
        const normalized = normalizeChart(raw);
        return {
          symbol,
          shortName: normalized.shortName,
          currency: normalized.currency,
          price: normalized.price,
          previousClose: normalized.previousClose,
          change: normalized.change,
          changePercent: normalized.changePercent,
        };
      } catch (err) {
        return { symbol, error: true, message: err.message };
      }
    })
  );

  return jsonResponse({ quotes });
}

async function handleChart(url) {
  const symbol = url.searchParams.get("symbol");
  const range = url.searchParams.get("range") || "3mo";
  const interval = url.searchParams.get("interval") || "1d";

  if (!symbol) {
    return jsonResponse({ error: true, message: "symbol is required" }, 400);
  }

  try {
    const raw = await fetchChart(symbol, range, interval);
    const normalized = normalizeChart(raw);
    return jsonResponse({
      symbol: normalized.symbol,
      currency: normalized.currency,
      points: normalized.points,
    });
  } catch (err) {
    return jsonResponse({ error: true, message: err.message }, 404);
  }
}

async function handleSearch(url) {
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) {
    return jsonResponse({ results: [] });
  }

  let primaryResults;
  try {
    const raw = await fetchSearch(q);
    primaryResults = normalizeSearch(raw);
  } catch (err) {
    return jsonResponse({ error: true, message: err.message }, 502);
  }

  const japanResults = await fetchJapanSearchSupplement(q);
  const seenSymbols = new Set(primaryResults.map((r) => r.symbol));
  const merged = primaryResults.concat(japanResults.filter((r) => !seenSymbols.has(r.symbol)));

  return jsonResponse({ results: merged });
}

// Best-effort: a failure here (network error, or Yahoo Japan changing their
// page so extractPreloadedState can't find/parse the embedded state) should
// never fail the whole search — the primary results still stand on their own.
async function fetchJapanSearchSupplement(query) {
  try {
    const html = await fetchJapanSearchHtml(query);
    const state = extractPreloadedState(html);
    if (!state) return [];
    return normalizeJapanSearch(state);
  } catch {
    return [];
  }
}
