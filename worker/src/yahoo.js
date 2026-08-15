const YAHOO_CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/";
const YAHOO_SEARCH_BASE = "https://query1.finance.yahoo.com/v1/finance/search";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const KNOWN_QUOTE_TYPES = new Set(["EQUITY", "INDEX", "CURRENCY", "ETF"]);

export async function fetchChart(symbol, range, interval) {
  const url = `${YAHOO_CHART_BASE}${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  return res.json();
}

export async function fetchSearch(query) {
  const url = `${YAHOO_SEARCH_BASE}?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  return res.json();
}

export function normalizeChart(raw) {
  const result = raw?.chart?.result?.[0];
  if (!result) {
    const message = raw?.chart?.error?.description || "銘柄データが見つかりません";
    throw new Error(message);
  }

  const meta = result.meta || {};
  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];

  const points = timestamps
    .map((ts, i) => ({ date: toDateString(ts), close: closes[i] }))
    .filter((p) => typeof p.close === "number");

  const price = typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice : null;
  const previousClose =
    typeof meta.chartPreviousClose === "number"
      ? meta.chartPreviousClose
      : typeof meta.previousClose === "number"
        ? meta.previousClose
        : null;
  const change = price !== null && previousClose !== null ? price - previousClose : null;
  const changePercent = change !== null && previousClose ? (change / previousClose) * 100 : null;

  return {
    symbol: meta.symbol || null,
    currency: meta.currency || null,
    shortName: meta.shortName || meta.symbol || null,
    price,
    previousClose,
    change,
    changePercent,
    points,
  };
}

export function normalizeSearch(raw) {
  const quotes = raw?.quotes || [];
  return quotes
    .filter((q) => q.symbol && KNOWN_QUOTE_TYPES.has(q.quoteType))
    .map((q) => ({
      symbol: q.symbol,
      name: q.shortname || q.longname || q.symbol,
      exchange: q.exchange || "",
      type: q.quoteType || "",
    }));
}

function toDateString(unixSeconds) {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}
