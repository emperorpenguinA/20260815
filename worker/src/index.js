import {
  fetchChart,
  fetchSearch,
  normalizeChart,
  normalizeSearch,
  fetchJapanSearchHtml,
  extractPreloadedState,
  normalizeJapanSearch,
} from "./yahoo.js";
import {
  computeYoyPercent,
  takeRecentMonths,
  fetchBojPriceIndex,
  normalizeBojPriceIndex,
  BOJ_SERIES,
  fetchJapanCpi,
  normalizeJapanCpi,
  JAPAN_CPI_STATS_DATA_ID,
  fetchUsIndicator,
  normalizeUsIndicator,
  FRED_SERIES,
} from "./econ.js";
import {
  PPP_CURRENCIES,
  PPP_JPY_CROSS_CURRENCIES,
  fetchWorldBankPpp,
  normalizeWorldBankPpp,
  latestPppEntry,
  forwardFillPpp,
  toLcuPerUsd,
  computeOverUndervaluedPercent,
  buildCrossPppByYear,
} from "./ppp.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {
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
    if (url.pathname === "/api/econ") {
      return handleEcon(env, parseMonthsParam(url));
    }
    if (url.pathname === "/api/ppp") {
      return handlePpp(parseMonthsParam(url));
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

const MONTHS_DEFAULT = 36;
const MONTHS_MIN = 6;
const MONTHS_MAX = 600;

// フロントエンドの期間選択(1年/3年/5年/10年)から渡される。/api/econと
// /api/pppの両方で共有する。範囲外・不正な値は既定の3年にフォールバックする。
function parseMonthsParam(url) {
  const param = url.searchParams.get("months");
  // searchParams.get() returns null when absent, and Number(null) is 0
  // (not NaN) — check for the missing case explicitly before coercing.
  if (param === null) return MONTHS_DEFAULT;

  const raw = Number(param);
  if (!Number.isFinite(raw) || !Number.isInteger(raw)) {
    return MONTHS_DEFAULT;
  }
  return Math.min(MONTHS_MAX, Math.max(MONTHS_MIN, raw));
}

async function handleEcon(env, months = MONTHS_DEFAULT) {
  const now = new Date();
  const endDate = formatYyyymm(now);
  const startDate = formatYyyymm(new Date(now.getFullYear(), now.getMonth() - months, 1));

  const jobs = [
    {
      id: "jp-cpi",
      country: "JP",
      label: "消費者物価指数(CPI)",
      run: () => fetchJapanCpi(env.ESTAT_APP_ID, JAPAN_CPI_STATS_DATA_ID).then(normalizeJapanCpi),
    },
    {
      id: "jp-ppi-domestic",
      country: "JP",
      label: "国内企業物価指数(PPI)",
      run: () => fetchBojPriceIndex(BOJ_SERIES.ppiDomestic, startDate, endDate).then(normalizeBojPriceIndex),
    },
    {
      id: "jp-ppi-export",
      country: "JP",
      label: "輸出物価指数",
      run: () => fetchBojPriceIndex(BOJ_SERIES.ppiExport, startDate, endDate).then(normalizeBojPriceIndex),
    },
    {
      id: "jp-ppi-import",
      country: "JP",
      label: "輸入物価指数",
      run: () => fetchBojPriceIndex(BOJ_SERIES.ppiImport, startDate, endDate).then(normalizeBojPriceIndex),
    },
    {
      id: "us-cpi",
      country: "US",
      label: "消費者物価指数(CPI)",
      run: () => fetchUsIndicator(FRED_SERIES.cpi, env.FRED_API_KEY).then(normalizeUsIndicator),
    },
    {
      id: "us-ppi-domestic",
      country: "US",
      label: "生産者物価指数(PPI)",
      run: () => fetchUsIndicator(FRED_SERIES.ppiDomestic, env.FRED_API_KEY).then(normalizeUsIndicator),
    },
    {
      id: "us-ppi-export",
      country: "US",
      label: "輸出物価指数",
      run: () => fetchUsIndicator(FRED_SERIES.ppiExport, env.FRED_API_KEY).then(normalizeUsIndicator),
    },
    {
      id: "us-ppi-import",
      country: "US",
      label: "輸入物価指数",
      run: () => fetchUsIndicator(FRED_SERIES.ppiImport, env.FRED_API_KEY).then(normalizeUsIndicator),
    },
  ];

  const indicators = await Promise.all(
    jobs.map(async (job) => {
      try {
        const { points: rawPoints } = await job.run();
        const points = takeRecentMonths(rawPoints, months);
        return {
          id: job.id,
          country: job.country,
          label: job.label,
          points,
          yoyPercent: computeYoyPercent(points),
          latestDate: points.length > 0 ? points[points.length - 1].date : null,
        };
      } catch (err) {
        return { id: job.id, country: job.country, label: job.label, error: true, message: err.message };
      }
    })
  );

  return jsonResponse({ indicators });
}

async function handlePpp(months = MONTHS_DEFAULT) {
  const now = new Date();
  const endYear = now.getFullYear();
  const startYear = endYear - 15; // 10年(120ヶ月)の最大選択期間 + 予備で十分な幅

  const iso3Codes = [
    ...new Set([...PPP_CURRENCIES.map((c) => c.iso3), ...PPP_JPY_CROSS_CURRENCIES.map((c) => c.iso3)]),
  ];

  let pppRaw;
  let pppFetchError = null;
  try {
    pppRaw = await fetchWorldBankPpp(iso3Codes, startYear, endYear);
  } catch (err) {
    pppFetchError = err;
  }

  const indicators = await Promise.all(
    PPP_CURRENCIES.map((config) => buildPppIndicator(config, pppRaw, pppFetchError, months))
  );

  const crossIndicators = await Promise.all(
    PPP_JPY_CROSS_CURRENCIES.map((config) => buildJpyCrossIndicator(config, pppRaw, pppFetchError, months))
  );

  return jsonResponse({ indicators, crossIndicators });
}

async function buildPppIndicator(config, pppRaw, pppFetchError, months) {
  try {
    if (pppFetchError) throw pppFetchError;

    const pppByYear = normalizeWorldBankPpp(pppRaw, config.iso3);
    const latest = latestPppEntry(pppByYear);
    if (!latest) {
      throw new Error(`PPPデータが見つかりません: ${config.iso3}`);
    }

    const chartRaw = await fetchChart(config.yahooSymbol, "10y", "1mo");
    const { points: rawPoints } = normalizeChart(chartRaw);
    const monthlyPoints = takeRecentMonths(
      rawPoints
        .map((p) => ({
          date: typeof p.date === "string" ? p.date.slice(0, 7) : null,
          value: toLcuPerUsd(p.close, config.invert),
        }))
        .filter((p) => p.date !== null && typeof p.value === "number"),
      months
    );

    const monthDates = monthlyPoints.map((p) => p.date);
    const pppSeries = forwardFillPpp(monthDates, pppByYear);
    const points = monthlyPoints
      .map((p, i) => ({ date: p.date, actual: p.value, ppp: pppSeries[i] }))
      .filter((p) => typeof p.ppp === "number");

    const latestActual = monthlyPoints.length > 0 ? monthlyPoints[monthlyPoints.length - 1].value : null;

    return {
      currency: config.currency,
      pair: config.pair,
      points,
      latestActual,
      latestPpp: latest.value,
      pppYear: latest.year,
      overUndervaluedPercent: computeOverUndervaluedPercent(latestActual, latest.value),
      note: config.note,
    };
  } catch (err) {
    return { currency: config.currency, pair: config.pair, error: true, message: err.message };
  }
}

// 対米ドル比較(buildPppIndicator)と違い、PPP理論レートはWorld Bankの
// 生データを日本円と対象通貨それぞれについて正規化してから比率を取る
// (buildCrossPppByYear)。実勢レートはYahooの直接クロスシンボルの値を
// そのまま使い、toLcuPerUsdによる逆数変換は行わない。
async function buildJpyCrossIndicator(config, pppRaw, pppFetchError, months) {
  try {
    if (pppFetchError) throw pppFetchError;

    const jpyPppByYear = normalizeWorldBankPpp(pppRaw, "JPN");
    const quotePppByYear = normalizeWorldBankPpp(pppRaw, config.iso3);
    const crossPppByYear = buildCrossPppByYear(jpyPppByYear, quotePppByYear);
    const latest = latestPppEntry(crossPppByYear);
    if (!latest) {
      throw new Error(`PPPデータが見つかりません: JPN/${config.iso3}`);
    }

    const chartRaw = await fetchChart(config.yahooSymbol, "10y", "1mo");
    const { points: rawPoints } = normalizeChart(chartRaw);
    const monthlyPoints = takeRecentMonths(
      rawPoints
        .map((p) => ({
          date: typeof p.date === "string" ? p.date.slice(0, 7) : null,
          value: typeof p.close === "number" ? p.close : null,
        }))
        .filter((p) => p.date !== null && typeof p.value === "number"),
      months
    );

    const monthDates = monthlyPoints.map((p) => p.date);
    const pppSeries = forwardFillPpp(monthDates, crossPppByYear);
    const points = monthlyPoints
      .map((p, i) => ({ date: p.date, actual: p.value, ppp: pppSeries[i] }))
      .filter((p) => typeof p.ppp === "number");

    const latestActual = monthlyPoints.length > 0 ? monthlyPoints[monthlyPoints.length - 1].value : null;

    return {
      currency: config.currency,
      pair: config.pair,
      points,
      latestActual,
      latestPpp: latest.value,
      pppYear: latest.year,
      overUndervaluedPercent: computeOverUndervaluedPercent(latestActual, latest.value),
      note: config.note,
    };
  } catch (err) {
    return { currency: config.currency, pair: config.pair, error: true, message: err.message };
  }
}

function formatYyyymm(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}${month}`;
}
