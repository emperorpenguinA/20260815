import test from "node:test";
import assert from "node:assert/strict";
import { normalizeChart, normalizeSearch, fetchChart } from "../src/yahoo.js";

test("normalizeChart parses a valid chart response", () => {
  const raw = {
    chart: {
      result: [
        {
          meta: {
            currency: "JPY",
            symbol: "^N225",
            regularMarketPrice: 39000.12,
            chartPreviousClose: 38800,
            shortName: "Nikkei 225",
          },
          timestamp: [1704067200, 1704153600],
          indicators: { quote: [{ close: [38000.5, 38120] }] },
        },
      ],
      error: null,
    },
  };

  const result = normalizeChart(raw);

  assert.equal(result.symbol, "^N225");
  assert.equal(result.currency, "JPY");
  assert.equal(result.shortName, "Nikkei 225");
  assert.equal(result.price, 39000.12);
  assert.equal(result.previousClose, 38800);
  assert.ok(Math.abs(result.change - 200.12) < 0.001);
  assert.ok(Math.abs(result.changePercent - 0.515773) < 0.001);
  assert.equal(result.points.length, 2);
  assert.equal(result.points[0].date, "2024-01-01");
  assert.equal(result.points[0].close, 38000.5);
  assert.equal(result.points[1].date, "2024-01-02");
});

test("normalizeChart throws when upstream reports an error", () => {
  const raw = {
    chart: {
      result: null,
      error: { code: "Not Found", description: "No data found, symbol may be delisted" },
    },
  };

  assert.throws(() => normalizeChart(raw), /No data found/);
});

test("normalizeChart filters out points with missing close values", () => {
  const raw = {
    chart: {
      result: [
        {
          meta: { currency: "USD", symbol: "AAPL", regularMarketPrice: 190, chartPreviousClose: 188 },
          timestamp: [1704067200, 1704153600, 1704240000],
          indicators: { quote: [{ close: [185, null, 190] }] },
        },
      ],
      error: null,
    },
  };

  const result = normalizeChart(raw);

  assert.equal(result.points.length, 2);
  assert.equal(result.points[0].close, 185);
  assert.equal(result.points[1].close, 190);
});

test("normalizeSearch keeps only known quote types and maps fields", () => {
  const raw = {
    quotes: [
      { symbol: "7203.T", shortname: "Toyota Motor Corp", exchange: "JPX", quoteType: "EQUITY" },
      { symbol: "SOMENEWS", quoteType: "NEWS" },
    ],
  };

  const results = normalizeSearch(raw);

  assert.equal(results.length, 1);
  assert.deepEqual(results[0], {
    symbol: "7203.T",
    name: "Toyota Motor Corp",
    exchange: "JPX",
    type: "EQUITY",
  });
});

test("normalizeSearch returns an empty array when quotes is missing", () => {
  const results = normalizeSearch({});
  assert.deepEqual(results, []);
});

test("fetchChart retries on a transient 503 and succeeds on the next attempt", async () => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return { ok: false, status: 503, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => ({ chart: { result: [], error: null } }) };
  };

  try {
    const raw = await fetchChart("^N225", "1d", "1d");
    assert.equal(calls, 2);
    assert.deepEqual(raw, { chart: { result: [], error: null } });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchChart gives up after repeated network failures and reports the last error", async () => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("network down");
  };

  try {
    await assert.rejects(() => fetchChart("^N225", "1d", "1d"), /network down/);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchChart does not retry a non-retryable 404 response", async () => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: false, status: 404, json: async () => ({ chart: { result: null, error: { description: "not found" } } }) };
  };

  try {
    const raw = await fetchChart("BADSYMBOL", "1d", "1d");
    assert.equal(calls, 1);
    assert.equal(raw.chart.error.description, "not found");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
