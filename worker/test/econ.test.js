import test from "node:test";
import assert from "node:assert/strict";
import {
  computeYoyPercent,
  takeRecentMonths,
  normalizeBojPriceIndex,
  fetchBojPriceIndex,
  BOJ_SERIES,
  fetchJapanCpi,
  normalizeJapanCpi,
  normalizeUsIndicator,
  fetchUsIndicator,
  FRED_SERIES,
} from "../src/econ.js";

test("computeYoyPercent computes the percent change between the latest point and the same month one year earlier", () => {
  const points = [
    { date: "2025-01", value: 100 },
    { date: "2025-02", value: 101 },
    { date: "2025-03", value: 102 },
    { date: "2025-04", value: 103 },
    { date: "2025-05", value: 104 },
    { date: "2025-06", value: 105 },
    { date: "2025-07", value: 106 },
    { date: "2025-08", value: 107 },
    { date: "2025-09", value: 108 },
    { date: "2025-10", value: 109 },
    { date: "2025-11", value: 110 },
    { date: "2025-12", value: 111 },
    { date: "2026-01", value: 112 },
  ];

  const result = computeYoyPercent(points);

  assert.ok(Math.abs(result - 12) < 0.001);
});

test("computeYoyPercent returns null when the same month one year earlier is missing (a gap in the series)", () => {
  const points = [
    { date: "2025-02", value: 100 },
    { date: "2026-01", value: 112 },
  ];
  assert.equal(computeYoyPercent(points), null);
});

test("computeYoyPercent returns null when there are no points", () => {
  assert.equal(computeYoyPercent([]), null);
});

test("computeYoyPercent returns null when the year-ago value is zero (avoid divide by zero)", () => {
  const points = [
    { date: "2025-01", value: 0 },
    { date: "2026-01", value: 100 },
  ];
  assert.equal(computeYoyPercent(points), null);
});

test("takeRecentMonths keeps only the last N points", () => {
  const points = [{ value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }];
  assert.deepEqual(takeRecentMonths(points, 2), [{ value: 3 }, { value: 4 }]);
});

test("takeRecentMonths returns all points when there are fewer than N", () => {
  const points = [{ value: 1 }];
  assert.deepEqual(takeRecentMonths(points, 5), [{ value: 1 }]);
});

test("normalizeBojPriceIndex converts SURVEY_DATES/VALUES into {date, value} points", () => {
  const raw = {
    RESULTSET: [
      {
        SERIES_CODE: "PRCG20_2200000000",
        VALUES: {
          SURVEY_DATES: [202501, 202502, 202503],
          VALUES: [125.5, 125.8, 126.2],
        },
      },
    ],
  };

  const result = normalizeBojPriceIndex(raw);

  assert.deepEqual(result.points, [
    { date: "2025-01", value: 125.5 },
    { date: "2025-02", value: 125.8 },
    { date: "2025-03", value: 126.2 },
  ]);
});

test("normalizeBojPriceIndex throws when RESULTSET is missing", () => {
  assert.throws(() => normalizeBojPriceIndex({}), /日銀統計データが見つかりません/);
});

test("normalizeBojPriceIndex filters out non-numeric values", () => {
  const raw = {
    RESULTSET: [
      {
        VALUES: {
          SURVEY_DATES: [202501, 202502],
          VALUES: [125.5, null],
        },
      },
    ],
  };

  const result = normalizeBojPriceIndex(raw);

  assert.equal(result.points.length, 1);
  assert.equal(result.points[0].value, 125.5);
});

test("fetchBojPriceIndex requests the BOJ time-series API with the given series code and date range", async () => {
  const requestedUrls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requestedUrls.push(url.toString());
    return { ok: true, json: async () => ({ RESULTSET: [] }) };
  };

  try {
    await fetchBojPriceIndex(BOJ_SERIES.ppiDomestic, "202501", "202607");
    assert.equal(requestedUrls.length, 1);
    assert.match(requestedUrls[0], /db=PR01/);
    assert.match(requestedUrls[0], /code=PRCG20_2200000000/);
    assert.match(requestedUrls[0], /startDate=202501/);
    assert.match(requestedUrls[0], /endDate=202607/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("normalizeJapanCpi converts an array of VALUE entries into {date, value} points", () => {
  const raw = {
    GET_STATS_DATA: {
      STATISTICAL_DATA: {
        DATA_INF: {
          VALUE: [
            { "@time": "202501000000", $: "107.5" },
            { "@time": "202502000000", $: "107.8" },
          ],
        },
      },
    },
  };

  const result = normalizeJapanCpi(raw);

  assert.deepEqual(result.points, [
    { date: "2025-01", value: 107.5 },
    { date: "2025-02", value: 107.8 },
  ]);
});

test("normalizeJapanCpi handles a single VALUE object (not wrapped in an array), which e-Stat returns when there is only one result", () => {
  const raw = {
    GET_STATS_DATA: {
      STATISTICAL_DATA: {
        DATA_INF: {
          VALUE: { "@time": "202501000000", $: "107.5" },
        },
      },
    },
  };

  const result = normalizeJapanCpi(raw);

  assert.deepEqual(result.points, [{ date: "2025-01", value: 107.5 }]);
});

test("normalizeJapanCpi sorts points chronologically", () => {
  const raw = {
    GET_STATS_DATA: {
      STATISTICAL_DATA: {
        DATA_INF: {
          VALUE: [
            { "@time": "202502000000", $: "107.8" },
            { "@time": "202501000000", $: "107.5" },
          ],
        },
      },
    },
  };

  const result = normalizeJapanCpi(raw);

  assert.deepEqual(
    result.points.map((p) => p.date),
    ["2025-01", "2025-02"]
  );
});

test("normalizeJapanCpi throws when DATA_INF.VALUE is missing", () => {
  assert.throws(() => normalizeJapanCpi({}), /消費者物価指数データが見つかりません/);
});

test("normalizeJapanCpi filters out entries with a non-numeric value", () => {
  const raw = {
    GET_STATS_DATA: {
      STATISTICAL_DATA: {
        DATA_INF: {
          VALUE: [
            { "@time": "202501000000", $: "107.5" },
            { "@time": "202502000000", $: "-" },
          ],
        },
      },
    },
  };

  const result = normalizeJapanCpi(raw);

  assert.equal(result.points.length, 1);
});

test("normalizeJapanCpi throws when the table bundles multiple item categories (@cat01 varies across entries)", () => {
  const raw = {
    GET_STATS_DATA: {
      STATISTICAL_DATA: {
        DATA_INF: {
          VALUE: [
            { "@time": "202501", "@cat01": "0001", $: "107.5" },
            { "@time": "202501", "@cat01": "0002", $: "98.2" },
          ],
        },
      },
    },
  };

  assert.throws(() => normalizeJapanCpi(raw), /複数の分類/);
});

test("normalizeJapanCpi throws when the table bundles multiple regions (@area varies across entries)", () => {
  const raw = {
    GET_STATS_DATA: {
      STATISTICAL_DATA: {
        DATA_INF: {
          VALUE: [
            { "@time": "202501", "@area": "00000", $: "107.5" },
            { "@time": "202501", "@area": "13000", $: "110.1" },
          ],
        },
      },
    },
  };

  assert.throws(() => normalizeJapanCpi(raw), /複数の分類/);
});

test("normalizeJapanCpi succeeds when all entries share the same classification codes (single series)", () => {
  const raw = {
    GET_STATS_DATA: {
      STATISTICAL_DATA: {
        DATA_INF: {
          VALUE: [
            { "@time": "202501", "@area": "00000", "@cat01": "0001", $: "107.5" },
            { "@time": "202502", "@area": "00000", "@cat01": "0001", $: "107.8" },
          ],
        },
      },
    },
  };

  const result = normalizeJapanCpi(raw);

  assert.equal(result.points.length, 2);
});

test("toEstatMonthString rejects an out-of-range month (e.g. '00'), which normalizeJapanCpi then reports as an unrecognized time-code format if it's the only entry", () => {
  const raw = {
    GET_STATS_DATA: {
      STATISTICAL_DATA: {
        DATA_INF: {
          VALUE: [{ "@time": "202500999999", $: "107.5" }],
        },
      },
    },
  };

  assert.throws(() => normalizeJapanCpi(raw), /想定外の時間軸コード形式/);
});

test("fetchBojPriceIndex throws a clear error when the upstream response is not ok", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  try {
    await assert.rejects(() => fetchBojPriceIndex(BOJ_SERIES.ppiDomestic, "202501", "202607"), /日銀API上流エラー: 503/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchJapanCpi requests e-Stat's getStatsData with the given appId and statsDataId", async () => {
  const requestedUrls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requestedUrls.push(url.toString());
    return { ok: true, json: async () => ({}) };
  };

  try {
    await fetchJapanCpi("test-app-id", "0000000000");
    assert.equal(requestedUrls.length, 1);
    assert.match(requestedUrls[0], /appId=test-app-id/);
    assert.match(requestedUrls[0], /statsDataId=0000000000/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchJapanCpi throws a clear error when the upstream response is not ok", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
  try {
    await assert.rejects(() => fetchJapanCpi("bad-app-id", "0000000000"), /e-Stat上流エラー: 403/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("normalizeUsIndicator converts observations into {date, value} points, truncating the date to YYYY-MM", () => {
  const raw = {
    observations: [
      { date: "2025-01-01", value: "308.417" },
      { date: "2025-02-01", value: "309.685" },
    ],
  };

  const result = normalizeUsIndicator(raw);

  assert.deepEqual(result.points, [
    { date: "2025-01", value: 308.417 },
    { date: "2025-02", value: 309.685 },
  ]);
});

test("normalizeUsIndicator filters out FRED's '.' placeholder for a not-yet-published value", () => {
  const raw = {
    observations: [
      { date: "2025-01-01", value: "308.417" },
      { date: "2025-02-01", value: "." },
    ],
  };

  const result = normalizeUsIndicator(raw);

  assert.equal(result.points.length, 1);
});

test("normalizeUsIndicator throws when observations is missing or empty", () => {
  assert.throws(() => normalizeUsIndicator({}), /米国の指標データが見つかりません/);
  assert.throws(() => normalizeUsIndicator({ observations: [] }), /米国の指標データが見つかりません/);
});

test("fetchUsIndicator requests FRED's series/observations endpoint with the given series ID and API key", async () => {
  const requestedUrls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requestedUrls.push(url.toString());
    return { ok: true, json: async () => ({}) };
  };

  try {
    await fetchUsIndicator(FRED_SERIES.cpi, "test-api-key");
    assert.equal(requestedUrls.length, 1);
    assert.match(requestedUrls[0], /series_id=CPIAUCSL/);
    assert.match(requestedUrls[0], /api_key=test-api-key/);
    assert.match(requestedUrls[0], /file_type=json/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchUsIndicator throws a clear error when the upstream response is not ok", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({}) });
  try {
    await assert.rejects(() => fetchUsIndicator(FRED_SERIES.cpi, "bad-key"), /FRED上流エラー: 400/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
