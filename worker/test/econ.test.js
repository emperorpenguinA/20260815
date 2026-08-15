import test from "node:test";
import assert from "node:assert/strict";
import {
  computeYoyPercent,
  takeRecentMonths,
  normalizeBojPriceIndex,
  fetchBojPriceIndex,
  BOJ_SERIES,
} from "../src/econ.js";

test("computeYoyPercent computes the percent change between the latest point and 12 months earlier", () => {
  const points = [];
  for (let i = 0; i < 13; i++) {
    points.push({ date: `2025-${String(i + 1).padStart(2, "0")}`, value: 100 + i });
  }

  const result = computeYoyPercent(points);

  assert.ok(Math.abs(result - 12) < 0.001);
});

test("computeYoyPercent returns null when fewer than 13 points are available", () => {
  const points = [{ date: "2026-01", value: 100 }];
  assert.equal(computeYoyPercent(points), null);
});

test("computeYoyPercent returns null when the year-ago value is zero (avoid divide by zero)", () => {
  const points = [];
  for (let i = 0; i < 13; i++) {
    points.push({ date: `2025-${String(i + 1).padStart(2, "0")}`, value: i === 0 ? 0 : 100 });
  }
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
    return { json: async () => ({ RESULTSET: [] }) };
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
