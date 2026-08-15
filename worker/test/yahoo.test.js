import test from "node:test";
import assert from "node:assert/strict";
import { normalizeChart, normalizeSearch, fetchChart, extractPreloadedState, normalizeJapanSearch } from "../src/yahoo.js";

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

test("normalizeSearch prefers longname over shortname (Yahoo localizes longname, not shortname)", () => {
  const raw = {
    quotes: [
      {
        symbol: "7203.T",
        shortname: "TOYOTA MOTOR CORP",
        longname: "トヨタ自動車",
        exchange: "JPX",
        quoteType: "EQUITY",
      },
    ],
  };

  const results = normalizeSearch(raw);

  assert.equal(results[0].name, "トヨタ自動車");
});

test("normalizeSearch falls back to shortname when longname is absent", () => {
  const raw = {
    quotes: [{ symbol: "AAPL", shortname: "Apple Inc.", exchange: "NMS", quoteType: "EQUITY" }],
  };

  const results = normalizeSearch(raw);

  assert.equal(results[0].name, "Apple Inc.");
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

test("extractPreloadedState parses the JSON assigned to window.__PRELOADED_STATE__ out of an HTML page", () => {
  const html = `
    <html><body>
    <script>
      window.__SOMETHING_ELSE__ = {"unrelated": true};
      window.__PRELOADED_STATE__ = {"mainSearchList":{"results":[{"code":"8306","name":"三菱UFJ"}]}};
      doStuff();
    </script>
    </body></html>
  `;

  const state = extractPreloadedState(html);

  assert.deepEqual(state, { mainSearchList: { results: [{ code: "8306", name: "三菱UFJ" }] } });
});

test("extractPreloadedState handles braces and escaped quotes inside string values", () => {
  const html = `window.__PRELOADED_STATE__ = {"comment":"has a { brace } and a \\"quote\\" inside"};`;

  const state = extractPreloadedState(html);

  assert.deepEqual(state, { comment: 'has a { brace } and a "quote" inside' });
});

test("extractPreloadedState returns null when the marker is not present", () => {
  const state = extractPreloadedState("<html><body>no data here</body></html>");
  assert.equal(state, null);
});

test("extractPreloadedState returns null on malformed/truncated JSON", () => {
  const state = extractPreloadedState('window.__PRELOADED_STATE__ = {"unterminated": ');
  assert.equal(state, null);
});

test("normalizeJapanSearch maps a Tokyo-listed equity code to the .T symbol format", () => {
  const state = {
    mainSearchList: {
      results: [{ code: "8306", name: "(株)三菱ＵＦＪフィナンシャル・グループ", marketName: "東証PRM" }],
    },
  };

  const results = normalizeJapanSearch(state);

  assert.deepEqual(results, [
    { symbol: "8306.T", name: "(株)三菱ＵＦＪフィナンシャル・グループ", exchange: "東証PRM", type: "EQUITY" },
  ]);
});

test("normalizeJapanSearch keeps a foreign ticker code as-is", () => {
  const state = {
    mainSearchList: {
      results: [{ code: "AAPL", name: "アップル", marketName: "NASDAQ" }],
    },
  };

  const results = normalizeJapanSearch(state);

  assert.deepEqual(results, [{ symbol: "AAPL", name: "アップル", exchange: "NASDAQ", type: "EQUITY" }]);
});

test("normalizeJapanSearch filters out investment trusts (mutual funds), which use a different symbol namespace", () => {
  const state = {
    mainSearchList: {
      results: [
        { code: "0331101A", name: "三菱UFJ ＜DC＞ライフ･バランスF(安定型)", marketName: "投資信託" },
        { code: "8306", name: "(株)三菱ＵＦＪフィナンシャル・グループ", marketName: "東証PRM" },
      ],
    },
  };

  const results = normalizeJapanSearch(state);

  assert.equal(results.length, 1);
  assert.equal(results[0].symbol, "8306.T");
});

test("normalizeJapanSearch filters out results on unrecognized markets rather than guessing a symbol format", () => {
  const state = {
    mainSearchList: {
      results: [{ code: "1234", name: "何か", marketName: "名証" }],
    },
  };

  const results = normalizeJapanSearch(state);

  assert.deepEqual(results, []);
});

test("normalizeJapanSearch returns an empty array when mainSearchList is missing", () => {
  assert.deepEqual(normalizeJapanSearch({}), []);
  assert.deepEqual(normalizeJapanSearch(null), []);
});
