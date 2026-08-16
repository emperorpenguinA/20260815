import test from "node:test";
import assert from "node:assert/strict";
import handler from "../src/index.js";
import {
  PPP_CURRENCIES,
  PPP_JPY_CROSS_CURRENCIES,
} from "../src/ppp.js";

test("handleQuote requests a 1-day range from upstream (so previousClose is yesterday's close, not N days ago)", async () => {
  const requestedUrls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requestedUrls.push(url.toString());
    return {
      json: async () => ({
        chart: {
          result: [
            {
              meta: {
                currency: "JPY",
                symbol: "^N225",
                regularMarketPrice: 100,
                chartPreviousClose: 90,
              },
              timestamp: [],
              indicators: { quote: [{ close: [] }] },
            },
          ],
          error: null,
        },
      }),
    };
  };

  try {
    const request = new Request("https://example.com/api/quote?symbols=%5EN225");
    const response = await handler.fetch(request);
    const body = await response.json();

    assert.equal(requestedUrls.length, 1);
    assert.match(requestedUrls[0], /range=1d/);
    assert.equal(body.quotes[0].symbol, "^N225");
    assert.equal(body.quotes[0].price, 100);
    assert.equal(body.quotes[0].previousClose, 90);
    assert.equal(body.quotes[0].change, 10);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handleQuote isolates a per-symbol failure without failing the whole batch", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.toString().includes("BAD")) {
      return { json: async () => ({ chart: { result: null, error: { description: "No data found" } } }) };
    }
    return {
      json: async () => ({
        chart: {
          result: [
            {
              meta: { currency: "USD", symbol: "AAPL", regularMarketPrice: 200, chartPreviousClose: 190 },
              timestamp: [],
              indicators: { quote: [{ close: [] }] },
            },
          ],
          error: null,
        },
      }),
    };
  };

  try {
    const request = new Request("https://example.com/api/quote?symbols=AAPL,BAD");
    const response = await handler.fetch(request);
    const body = await response.json();

    assert.equal(body.quotes.length, 2);
    const aapl = body.quotes.find((q) => q.symbol === "AAPL");
    const bad = body.quotes.find((q) => q.symbol === "BAD");
    assert.equal(aapl.price, 200);
    assert.equal(bad.error, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handleQuote echoes back the originally requested symbol, even when Yahoo's response uses a different canonical form", async () => {
  // Yahoo's unofficial API sometimes echoes a different symbol string (e.g. "USDJPY=X")
  // than what was requested (e.g. "JPY=X"). The client matches quotes back to watchlist
  // items by the symbol it requested, so the response must echo that exact string back,
  // not whatever Yahoo's meta.symbol happens to say.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    json: async () => ({
      chart: {
        result: [
          {
            meta: {
              currency: "JPY",
              symbol: "USDJPY=X",
              regularMarketPrice: 159.3,
              chartPreviousClose: 159.5,
            },
            timestamp: [],
            indicators: { quote: [{ close: [] }] },
          },
        ],
        error: null,
      },
    }),
  });

  try {
    const request = new Request("https://example.com/api/quote?symbols=JPY%3DX");
    const response = await handler.fetch(request);
    const body = await response.json();

    assert.equal(body.quotes[0].symbol, "JPY=X");
    assert.equal(body.quotes[0].price, 159.3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handleSearch merges results from the primary search with the Japan-search supplement, deduplicated by symbol", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const urlString = url.toString();
    if (urlString.includes("finance.yahoo.co.jp")) {
      return {
        text: async () =>
          `window.__PRELOADED_STATE__ = ${JSON.stringify({
            mainSearchList: {
              results: [
                { code: "8306", name: "三菱ＵＦＪフィナンシャル・グループ", marketName: "東証PRM" },
                { code: "MUFG", name: "重複するはずの銘柄", marketName: "NYSE" },
              ],
            },
          })};`,
      };
    }
    return {
      json: async () => ({
        quotes: [{ symbol: "MUFG", shortname: "MITSUBISHI UFJ FINANCIAL", exchange: "NYQ", quoteType: "EQUITY" }],
      }),
    };
  };

  try {
    const request = new Request("https://example.com/api/search?q=UFJ");
    const response = await handler.fetch(request);
    const body = await response.json();

    const symbols = body.results.map((r) => r.symbol);
    assert.deepEqual(symbols, ["MUFG", "8306.T"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handleSearch still returns primary results when the Japan-search supplement fails", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const urlString = url.toString();
    if (urlString.includes("finance.yahoo.co.jp")) {
      throw new Error("supplement unreachable");
    }
    return {
      json: async () => ({
        quotes: [{ symbol: "AAPL", shortname: "Apple Inc.", exchange: "NMS", quoteType: "EQUITY" }],
      }),
    };
  };

  try {
    const request = new Request("https://example.com/api/search?q=apple");
    const response = await handler.fetch(request);
    const body = await response.json();

    assert.deepEqual(
      body.results.map((r) => r.symbol),
      ["AAPL"]
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handleSearch still fails when the primary search itself fails, regardless of the supplement", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const urlString = url.toString();
    if (urlString.includes("finance.yahoo.co.jp")) {
      return { text: async () => "<html>no data</html>" };
    }
    throw new Error("primary search down");
  };

  try {
    const request = new Request("https://example.com/api/search?q=apple");
    const response = await handler.fetch(request);

    assert.equal(response.status, 502);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handleEcon aggregates all 8 indicators and isolates per-indicator failures", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const urlString = url.toString();
    if (urlString.includes("api.e-stat.go.jp")) {
      throw new Error("e-Stat unreachable");
    }
    if (urlString.includes("stat-search.boj.or.jp")) {
      return {
        ok: true,
        json: async () => ({
          RESULTSET: [
            {
              VALUES: {
                SURVEY_DATES: [202501, 202502, 202503, 202504, 202505, 202506, 202507, 202508, 202509, 202510, 202511, 202512, 202601],
                VALUES: Array.from({ length: 13 }, (_, i) => 100 + i),
              },
            },
          ],
        }),
      };
    }
    if (urlString.includes("api.stlouisfed.org")) {
      return {
        ok: true,
        json: async () => ({
          observations: [
            { date: "2025-01-01", value: "200" },
            { date: "2025-02-01", value: "201" },
            { date: "2025-03-01", value: "202" },
            { date: "2025-04-01", value: "203" },
            { date: "2025-05-01", value: "204" },
            { date: "2025-06-01", value: "205" },
            { date: "2025-07-01", value: "206" },
            { date: "2025-08-01", value: "207" },
            { date: "2025-09-01", value: "208" },
            { date: "2025-10-01", value: "209" },
            { date: "2025-11-01", value: "210" },
            { date: "2025-12-01", value: "211" },
            { date: "2026-01-01", value: "212" },
          ],
        }),
      };
    }
    throw new Error(`unexpected URL: ${urlString}`);
  };

  try {
    const request = new Request("https://example.com/api/econ");
    const env = { ESTAT_APP_ID: "test-app-id", FRED_API_KEY: "test-fred-key" };
    const response = await handler.fetch(request, env);
    const body = await response.json();

    assert.equal(body.indicators.length, 8);

    const jpCpi = body.indicators.find((i) => i.id === "jp-cpi");
    assert.equal(jpCpi.error, true);

    const jpPpiDomestic = body.indicators.find((i) => i.id === "jp-ppi-domestic");
    assert.equal(jpPpiDomestic.error, undefined);
    assert.equal(jpPpiDomestic.points.length, 13);
    assert.ok(typeof jpPpiDomestic.yoyPercent === "number");

    const usCpi = body.indicators.find((i) => i.id === "us-cpi");
    assert.equal(usCpi.error, undefined);
    assert.equal(usCpi.points.length, 13);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function mockEconFetch() {
  return async (url) => {
    const urlString = url.toString();
    if (urlString.includes("api.e-stat.go.jp")) {
      throw new Error("e-Stat unreachable");
    }
    if (urlString.includes("stat-search.boj.or.jp")) {
      return {
        ok: true,
        json: async () => ({
          RESULTSET: [
            {
              VALUES: {
                SURVEY_DATES: [202501, 202502, 202503, 202504, 202505, 202506, 202507, 202508, 202509, 202510, 202511, 202512, 202601],
                VALUES: Array.from({ length: 13 }, (_, i) => 100 + i),
              },
            },
          ],
        }),
      };
    }
    if (urlString.includes("api.stlouisfed.org")) {
      return {
        ok: true,
        json: async () => ({
          observations: [
            { date: "2025-01-01", value: "200" },
            { date: "2025-02-01", value: "201" },
            { date: "2025-03-01", value: "202" },
            { date: "2025-04-01", value: "203" },
            { date: "2025-05-01", value: "204" },
            { date: "2025-06-01", value: "205" },
            { date: "2025-07-01", value: "206" },
            { date: "2025-08-01", value: "207" },
            { date: "2025-09-01", value: "208" },
            { date: "2025-10-01", value: "209" },
            { date: "2025-11-01", value: "210" },
            { date: "2025-12-01", value: "211" },
            { date: "2026-01-01", value: "212" },
          ],
        }),
      };
    }
    throw new Error(`unexpected URL: ${urlString}`);
  };
}

test("handleEcon truncates points to the ?months= query param instead of the 36-month default", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockEconFetch();

  try {
    const request = new Request("https://example.com/api/econ?months=6");
    const env = { ESTAT_APP_ID: "test-app-id", FRED_API_KEY: "test-fred-key" };
    const response = await handler.fetch(request, env);
    const body = await response.json();

    const jpPpiDomestic = body.indicators.find((i) => i.id === "jp-ppi-domestic");
    assert.equal(jpPpiDomestic.points.length, 6);

    const usCpi = body.indicators.find((i) => i.id === "us-cpi");
    assert.equal(usCpi.points.length, 6);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handleEcon applies the 36-month default when ?months= is absent (regression: URLSearchParams.get() returns null, and Number(null) is 0, not NaN — a naive check would wrongly clamp the missing case to the 6-month minimum)", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockEconFetch();

  try {
    const request = new Request("https://example.com/api/econ");
    const env = { ESTAT_APP_ID: "test-app-id", FRED_API_KEY: "test-fred-key" };
    const response = await handler.fetch(request, env);
    const body = await response.json();

    const jpPpiDomestic = body.indicators.find((i) => i.id === "jp-ppi-domestic");
    // Fixture has 13 points; under the 36-month default none are truncated.
    assert.equal(jpPpiDomestic.points.length, 13);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handleEcon clamps an out-of-range ?months= value (below the 6-month minimum) instead of applying it literally", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockEconFetch();

  try {
    const request = new Request("https://example.com/api/econ?months=1");
    const env = { ESTAT_APP_ID: "test-app-id", FRED_API_KEY: "test-fred-key" };
    const response = await handler.fetch(request, env);
    const body = await response.json();

    const jpPpiDomestic = body.indicators.find((i) => i.id === "jp-ppi-domestic");
    // Clamped to the 6-month minimum, not literally truncated to 1 point.
    assert.equal(jpPpiDomestic.points.length, 6);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function mockPppFetch({ worldBank, chartsBySymbol }) {
  return async (url) => {
    const urlString = url.toString();
    if (urlString.includes("api.worldbank.org")) {
      if (worldBank instanceof Error) throw worldBank;
      return { ok: true, json: async () => worldBank };
    }
    for (const [symbol, response] of Object.entries(chartsBySymbol)) {
      if (urlString.includes(`/chart/${encodeURIComponent(symbol)}?`)) {
        if (response instanceof Error) throw response;
        return { ok: true, json: async () => response };
      }
    }
    throw new Error(`unexpected URL: ${urlString}`);
  };
}

function fakeChartResponse(symbol, currency, monthlyCloses) {
  // monthlyCloses[i] is the close for the i-th month, oldest first.
  const base = Date.UTC(2024, 0, 1) / 1000;
  const dayMs = 30 * 24 * 3600;
  return {
    chart: {
      result: [
        {
          meta: { symbol, currency, regularMarketPrice: monthlyCloses.at(-1), chartPreviousClose: monthlyCloses.at(-1) },
          timestamp: monthlyCloses.map((_, i) => base + i * dayMs),
          indicators: { quote: [{ close: monthlyCloses }] },
        },
      ],
      error: null,
    },
  };
}

function fakeWorldBankResponse(entries) {
  // entries: [{ iso3, date, value }]
  return [
    { page: 1 },
    entries.map((e) => ({ countryiso3code: e.iso3, date: String(e.date), value: e.value })),
  ];
}

test("handlePpp aggregates all 6 currencies, converts EUR/GBP/AUD via reciprocal, and computes the over/undervaluation percent", async () => {
  const originalFetch = globalThis.fetch;
  // Two years of PPP data (2024 and 2025) so the fixture's chart points —
  // which span Jan-Mar 2024 — have an applicable PPP year to forward-fill
  // from; a single 2025-only fixture would leave `points` all-null (correct
  // behavior, but not what this test's chart dates are meant to exercise).
  const worldBank = fakeWorldBankResponse([
    { iso3: "JPN", date: 2025, value: 97.08 },
    { iso3: "JPN", date: 2024, value: 94.462599 },
    { iso3: "DEU", date: 2025, value: 0.71 },
    { iso3: "DEU", date: 2024, value: 0.700862 },
    { iso3: "GBR", date: 2025, value: 0.677133 },
    { iso3: "GBR", date: 2024, value: 0.664153 },
    { iso3: "CHN", date: 2025, value: 3.397686 },
    { iso3: "CHN", date: 2024, value: 3.525379 },
    { iso3: "AUS", date: 2025, value: 1.398943 },
    { iso3: "AUS", date: 2024, value: 1.366527 },
    { iso3: "CAN", date: 2025, value: 1.166683 },
    { iso3: "CAN", date: 2024, value: 1.150472 },
  ]);
  const chartsBySymbol = {
    "JPY=X": fakeChartResponse("JPY=X", "JPY", [150, 155, 159.31]),
    "EURUSD=X": fakeChartResponse("EURUSD=X", "USD", [1.1, 1.12, 1.1573]),
    "GBPUSD=X": fakeChartResponse("GBPUSD=X", "USD", [1.3, 1.32, 1.3536]),
    "CNY=X": fakeChartResponse("CNY=X", "CNY", [6.6, 6.7, 6.7322]),
    "AUDUSD=X": fakeChartResponse("AUDUSD=X", "USD", [0.7, 0.71, 0.7087]),
    "CAD=X": fakeChartResponse("CAD=X", "CAD", [1.35, 1.37, 1.3872]),
    "EURJPY=X": fakeChartResponse("EURJPY=X", "JPY", [180, 182, 184.365]),
    "GBPJPY=X": fakeChartResponse("GBPJPY=X", "JPY", [210, 212, 215.667]),
    "CNYJPY=X": fakeChartResponse("CNYJPY=X", "JPY", [23, 23.3, 23.595]),
    "AUDJPY=X": fakeChartResponse("AUDJPY=X", "JPY", [110, 111, 112.879]),
    "CADJPY=X": fakeChartResponse("CADJPY=X", "JPY", [113, 114, 114.818]),
  };
  globalThis.fetch = mockPppFetch({ worldBank, chartsBySymbol });

  try {
    const request = new Request("https://example.com/api/ppp");
    const response = await handler.fetch(request);
    const body = await response.json();

    assert.equal(body.indicators.length, 6);

    const jpy = body.indicators.find((i) => i.currency === "JPY");
    assert.equal(jpy.error, undefined);
    assert.equal(jpy.pair, "USD/JPY");
    assert.equal(jpy.latestActual, 159.31);
    assert.equal(jpy.latestPpp, 97.08);
    assert.equal(jpy.pppYear, 2025);
    assert.ok(jpy.overUndervaluedPercent > 60 && jpy.overUndervaluedPercent < 65);
    assert.equal(jpy.note, null);

    const eur = body.indicators.find((i) => i.currency === "EUR");
    // EURUSD=X's last close is 1.1573 (USD per EUR); inverted, actual should be 1/1.1573.
    assert.ok(Math.abs(eur.latestActual - 1 / 1.1573) < 1e-6);
    assert.match(eur.note, /ドイツ/);

    assert.equal(body.crossIndicators.length, 5);

    const eurJpy = body.crossIndicators.find((i) => i.currency === "EUR");
    assert.equal(eurJpy.error, undefined);
    assert.equal(eurJpy.pair, "EUR/JPY");
    // EURJPY=X's last close is 184.365 (JPY per EUR); used directly, no inversion.
    assert.equal(eurJpy.latestActual, 184.365);
    // PPP-implied EUR/JPY = JPY's PPP factor ÷ EUR's PPP factor = 97.08 / 0.71.
    assert.ok(Math.abs(eurJpy.latestPpp - 97.08 / 0.71) < 1e-6);
    assert.equal(eurJpy.pppYear, 2025);
    assert.match(eurJpy.note, /ドイツ/);

    const cnyJpy = body.crossIndicators.find((i) => i.currency === "CNY");
    assert.equal(cnyJpy.error, undefined);
    assert.equal(cnyJpy.pair, "CNY/JPY");
    assert.equal(cnyJpy.latestActual, 23.595);
    assert.equal(cnyJpy.note, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handlePpp requests World Bank PPP data for the union of PPP_CURRENCIES and PPP_JPY_CROSS_CURRENCIES iso3 codes", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  const worldBank = fakeWorldBankResponse(
    [...PPP_CURRENCIES, ...PPP_JPY_CROSS_CURRENCIES].map((c) => ({ iso3: c.iso3, date: 2025, value: 100 }))
  );
  const chartsBySymbol = Object.fromEntries(
    [...PPP_CURRENCIES, ...PPP_JPY_CROSS_CURRENCIES].map((c) => [
      c.yahooSymbol,
      fakeChartResponse(c.yahooSymbol, c.currency, [100, 101, 102]),
    ])
  );
  const innerFetch = mockPppFetch({ worldBank, chartsBySymbol });
  globalThis.fetch = async (url, ...rest) => {
    requestedUrls.push(url.toString());
    return innerFetch(url, ...rest);
  };

  try {
    const request = new Request("https://example.com/api/ppp");
    const response = await handler.fetch(request);
    await response.json();

    const worldBankUrl = requestedUrls.find((u) => u.includes("api.worldbank.org"));
    assert.ok(worldBankUrl, "expected a World Bank request URL to be captured");

    const unionIso3 = [
      ...new Set([...PPP_CURRENCIES.map((c) => c.iso3), ...PPP_JPY_CROSS_CURRENCIES.map((c) => c.iso3)]),
    ];
    for (const iso3 of unionIso3) {
      assert.ok(worldBankUrl.includes(iso3), `expected World Bank URL to include ${iso3}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handlePpp isolates a per-currency chart failure without failing the whole batch", async () => {
  const originalFetch = globalThis.fetch;
  const worldBank = fakeWorldBankResponse(
    PPP_CURRENCIES.map((c) => ({ iso3: c.iso3, date: 2025, value: 100 }))
  );
  const chartsBySymbol = Object.fromEntries(
    PPP_CURRENCIES.map((c) => [c.yahooSymbol, fakeChartResponse(c.yahooSymbol, c.currency, [100, 101, 102])])
  );
  chartsBySymbol["JPY=X"] = new Error("network down");
  globalThis.fetch = mockPppFetch({ worldBank, chartsBySymbol });

  try {
    const request = new Request("https://example.com/api/ppp");
    const response = await handler.fetch(request);
    const body = await response.json();

    const jpy = body.indicators.find((i) => i.currency === "JPY");
    assert.equal(jpy.error, true);

    const cny = body.indicators.find((i) => i.currency === "CNY");
    assert.equal(cny.error, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handlePpp marks every currency as failed when the World Bank request itself fails", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockPppFetch({ worldBank: new Error("World Bank unreachable"), chartsBySymbol: {} });

  try {
    const request = new Request("https://example.com/api/ppp");
    const response = await handler.fetch(request);
    const body = await response.json();

    assert.equal(body.indicators.length, 6);
    assert.ok(body.indicators.every((i) => i.error === true));

    assert.equal(body.crossIndicators.length, 5);
    assert.ok(body.crossIndicators.every((i) => i.error === true));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handlePpp truncates points to the ?months= query param", async () => {
  const originalFetch = globalThis.fetch;
  const worldBank = fakeWorldBankResponse(
    PPP_CURRENCIES.map((c) => ({ iso3: c.iso3, date: 2025, value: 100 }))
  );
  const closes = Array.from({ length: 24 }, (_, i) => 100 + i);
  const chartsBySymbol = Object.fromEntries(
    PPP_CURRENCIES.map((c) => [c.yahooSymbol, fakeChartResponse(c.yahooSymbol, c.currency, closes)])
  );
  globalThis.fetch = mockPppFetch({ worldBank, chartsBySymbol });

  try {
    const request = new Request("https://example.com/api/ppp?months=6");
    const response = await handler.fetch(request);
    const body = await response.json();

    const jpy = body.indicators.find((i) => i.currency === "JPY");
    assert.equal(jpy.points.length, 6);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handlePpp isolates a single JPY-cross currency's chart failure without affecting other cross currencies or the USD-based indicators", async () => {
  const originalFetch = globalThis.fetch;
  const worldBank = fakeWorldBankResponse(
    [...PPP_CURRENCIES, ...PPP_JPY_CROSS_CURRENCIES].map((c) => ({ iso3: c.iso3, date: 2025, value: c.currency === "JPY" ? 100 : 50 }))
  );
  const chartsBySymbol = Object.fromEntries(
    [...PPP_CURRENCIES, ...PPP_JPY_CROSS_CURRENCIES].map((c) => [c.yahooSymbol, fakeChartResponse(c.yahooSymbol, c.currency, [100, 101, 102])])
  );
  chartsBySymbol["EURJPY=X"] = new Error("network down");
  globalThis.fetch = mockPppFetch({ worldBank, chartsBySymbol });

  try {
    const request = new Request("https://example.com/api/ppp");
    const response = await handler.fetch(request);
    const body = await response.json();

    const eurJpy = body.crossIndicators.find((i) => i.currency === "EUR");
    assert.equal(eurJpy.error, true);

    const gbpJpy = body.crossIndicators.find((i) => i.currency === "GBP");
    assert.equal(gbpJpy.error, undefined);

    const jpyUsd = body.indicators.find((i) => i.currency === "JPY");
    assert.equal(jpyUsd.error, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handlePpp truncates crossIndicators' points to the ?months= query param, same as the USD-based indicators", async () => {
  const originalFetch = globalThis.fetch;
  const worldBank = fakeWorldBankResponse(
    [...PPP_CURRENCIES, ...PPP_JPY_CROSS_CURRENCIES].map((c) => ({ iso3: c.iso3, date: 2025, value: c.currency === "JPY" ? 100 : 50 }))
  );
  const closes = Array.from({ length: 24 }, (_, i) => 100 + i);
  const chartsBySymbol = Object.fromEntries(
    [...PPP_CURRENCIES, ...PPP_JPY_CROSS_CURRENCIES].map((c) => [c.yahooSymbol, fakeChartResponse(c.yahooSymbol, c.currency, closes)])
  );
  globalThis.fetch = mockPppFetch({ worldBank, chartsBySymbol });

  try {
    const request = new Request("https://example.com/api/ppp?months=6");
    const response = await handler.fetch(request);
    const body = await response.json();

    const eurJpy = body.crossIndicators.find((i) => i.currency === "EUR");
    assert.equal(eurJpy.points.length, 6);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
