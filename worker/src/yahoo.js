const YAHOO_CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/";
const YAHOO_SEARCH_BASE = "https://query1.finance.yahoo.com/v1/finance/search";
const YAHOO_JP_SEARCH_BASE = "https://finance.yahoo.co.jp/search/";
const PRELOADED_STATE_MARKER = "window.__PRELOADED_STATE__ = ";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const KNOWN_QUOTE_TYPES = new Set(["EQUITY", "INDEX", "CURRENCY", "ETF"]);

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 200;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok || !RETRYABLE_STATUS.has(res.status) || attempt === MAX_ATTEMPTS) {
        return res;
      }
      lastError = new Error(`upstream returned ${res.status}`);
    } catch (err) {
      lastError = err;
      if (attempt === MAX_ATTEMPTS) throw err;
    }
    await sleep(RETRY_DELAY_MS * attempt);
  }

  throw lastError;
}

export async function fetchChart(symbol, range, interval) {
  const url = `${YAHOO_CHART_BASE}${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const res = await fetchWithRetry(url, { headers: { "User-Agent": USER_AGENT } });
  return res.json();
}

export async function fetchSearch(query) {
  const url = `${YAHOO_SEARCH_BASE}?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0&lang=ja-JP&region=JP`;
  const res = await fetchWithRetry(url, { headers: { "User-Agent": USER_AGENT } });
  return res.json();
}

// Best-effort supplement for Japanese company-name search, which query1's
// unofficial search endpoint matches poorly (e.g. "UFJ" never surfaces the
// Tokyo-listed 8306.T). finance.yahoo.co.jp has no public JSON API for this,
// so this scrapes the JSON state embedded in its search results page. A
// single attempt, no retry: this is a supplement, not the primary source.
export async function fetchJapanSearchHtml(query) {
  const url = `${YAHOO_JP_SEARCH_BASE}?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  return res.text();
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
      name: q.longname || q.shortname || q.symbol,
      exchange: q.exchange || "",
      type: q.quoteType || "",
    }));
}

function toDateString(unixSeconds) {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

// Extracts the JSON assigned to `window.__PRELOADED_STATE__ = {...};` in a
// finance.yahoo.co.jp page. Brace-depth matching (rather than a regex) is
// needed because the JSON itself contains braces inside string values.
export function extractPreloadedState(html) {
  const markerIndex = html.indexOf(PRELOADED_STATE_MARKER);
  if (markerIndex === -1) return null;

  const start = markerIndex + PRELOADED_STATE_MARKER.length;
  let depth = 0;
  let inString = false;
  let escape = false;
  let i = start;

  for (; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }

  if (depth !== 0) return null;

  try {
    return JSON.parse(html.slice(start, i));
  } catch {
    return null;
  }
}

export function normalizeJapanSearch(state) {
  const results = state?.mainSearchList?.results || [];
  return results
    .map((r) => ({
      symbol: toJapanSearchSymbol(r),
      name: r.name,
      exchange: r.marketName || "",
      type: r.marketName === "外国為替" ? "CURRENCY" : "EQUITY",
    }))
    .filter((r) => r.symbol !== null);
}

// Yahoo Japan's search mixes stocks, currency pairs, ETFs, and investment
// trusts (mutual funds, which use an unrelated alphanumeric code namespace)
// in one flat list, with no field distinguishing them other than
// marketName. Rather than guess at a symbol for markets we haven't
// verified, unrecognized entries are dropped.
function toJapanSearchSymbol(result) {
  const code = result?.code;
  const marketName = result?.marketName || "";
  if (typeof code !== "string") return null;

  if (/^\d{4}$/.test(code) && marketName.startsWith("東証")) {
    return `${code}.T`;
  }
  if (marketName === "外国為替" && /^[A-Z0-9]+=X$/.test(code)) {
    return code;
  }
  if (/^[A-Z][A-Z0-9.-]*$/.test(code) && marketName !== "投資信託" && !marketName.startsWith("東証")) {
    return code;
  }
  return null;
}
