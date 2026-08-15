import test from "node:test";
import assert from "node:assert/strict";
import handler from "../src/index.js";

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
        json: async () => ({
          RESULTSET: [
            {
              VALUES: {
                SURVEY_DATES: Array.from({ length: 13 }, (_, i) => 202501 + i),
                VALUES: Array.from({ length: 13 }, (_, i) => 100 + i),
              },
            },
          ],
        }),
      };
    }
    if (urlString.includes("api.stlouisfed.org")) {
      return {
        json: async () => ({
          observations: Array.from({ length: 13 }, (_, i) => ({
            date: `2025-${String((i % 12) + 1).padStart(2, "0")}-01`,
            value: String(200 + i),
          })),
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
