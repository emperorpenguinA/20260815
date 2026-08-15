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
