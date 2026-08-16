import test from "node:test";
import assert from "node:assert/strict";
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
} from "../src/ppp.js";

test("PPP_CURRENCIES lists exactly the 10 target currencies with the expected invert flags", () => {
  const byCurrency = Object.fromEntries(PPP_CURRENCIES.map((c) => [c.currency, c]));
  assert.equal(PPP_CURRENCIES.length, 10);
  assert.equal(byCurrency.JPY.invert, false);
  assert.equal(byCurrency.CNY.invert, false);
  assert.equal(byCurrency.CAD.invert, false);
  assert.equal(byCurrency.EUR.invert, true);
  assert.equal(byCurrency.GBP.invert, true);
  assert.equal(byCurrency.AUD.invert, true);
  // EUR uses Germany as the euro-area proxy (World Bank's EMU aggregate
  // has no PA.NUS.PPP data), and must carry a user-visible note about it.
  assert.equal(byCurrency.EUR.iso3, "DEU");
  assert.match(byCurrency.EUR.note, /ドイツ/);
  // New currencies: NZD is quoted USD-per-unit on Yahoo (like EUR/GBP/AUD),
  // TRY/MXN/ZAR are quoted unit-per-USD (like JPY/CNY/CAD).
  assert.equal(byCurrency.NZD.invert, true);
  assert.equal(byCurrency.TRY.invert, false);
  assert.equal(byCurrency.MXN.invert, false);
  assert.equal(byCurrency.ZAR.invert, false);
  assert.equal(byCurrency.NZD.note, null);
  assert.equal(byCurrency.TRY.note, null);
  assert.equal(byCurrency.MXN.note, null);
  assert.equal(byCurrency.ZAR.note, null);
});

test("PPP_CURRENCIES pair labels are all expressed as \"USD/<currency>\", matching the LCU-per-USD direction every rate is normalized to", () => {
  const pairs = Object.fromEntries(PPP_CURRENCIES.map((c) => [c.currency, c.pair]));
  assert.deepEqual(pairs, {
    JPY: "USD/JPY",
    EUR: "USD/EUR",
    GBP: "USD/GBP",
    CNY: "USD/CNY",
    AUD: "USD/AUD",
    CAD: "USD/CAD",
    NZD: "USD/NZD",
    TRY: "USD/TRY",
    MXN: "USD/MXN",
    ZAR: "USD/ZAR",
  });
});

test("normalizeWorldBankPpp returns a {year: value} map for the given country, filtering out null years and other countries", () => {
  const raw = [
    { page: 1 },
    [
      { countryiso3code: "JPN", date: "2025", value: 97.08 },
      { countryiso3code: "JPN", date: "2024", value: 94.462599 },
      { countryiso3code: "JPN", date: "2023", value: null },
      { countryiso3code: "GBR", date: "2025", value: 0.677133 },
    ],
  ];

  const result = normalizeWorldBankPpp(raw, "JPN");

  assert.deepEqual(result, { 2025: 97.08, 2024: 94.462599 });
});

test("normalizeWorldBankPpp returns an empty map when no data exists for the given country", () => {
  const raw = [{ page: 1 }, [{ countryiso3code: "GBR", date: "2025", value: 0.68 }]];

  assert.deepEqual(normalizeWorldBankPpp(raw, "JPN"), {});
});

test("latestPppEntry returns the entry for the maximum year in the map", () => {
  assert.deepEqual(latestPppEntry({ 2023: 90, 2025: 97.08, 2024: 94.46 }), { year: 2025, value: 97.08 });
});

test("latestPppEntry returns null for an empty map", () => {
  assert.equal(latestPppEntry({}), null);
});

test("forwardFillPpp uses the exact year's value when the month's year has data", () => {
  assert.deepEqual(forwardFillPpp(["2024-06"], { 2023: 90, 2024: 95 }), [95]);
});

test("forwardFillPpp carries forward the latest prior year's value when the month's year has no data yet (e.g. this year's PPP not published yet)", () => {
  assert.deepEqual(forwardFillPpp(["2026-07"], { 2024: 95, 2025: 97.08 }), [97.08]);
});

test("forwardFillPpp returns null when no year at or before the month's year exists", () => {
  assert.deepEqual(forwardFillPpp(["2005-01"], { 2024: 95, 2025: 97 }), [null]);
});

test("forwardFillPpp handles multiple months spanning several PPP-year boundaries", () => {
  const result = forwardFillPpp(
    ["2023-11", "2024-03", "2025-01", "2026-06"],
    { 2023: 90, 2024: 95, 2025: 97.08 }
  );
  assert.deepEqual(result, [90, 95, 97.08, 97.08]);
});

test("toLcuPerUsd returns the rate unchanged when invert is false", () => {
  assert.equal(toLcuPerUsd(159.31, false), 159.31);
});

test("toLcuPerUsd returns the reciprocal when invert is true", () => {
  assert.ok(Math.abs(toLcuPerUsd(1.1573, true) - 1 / 1.1573) < 1e-9);
});

test("toLcuPerUsd returns null for a non-numeric rate", () => {
  assert.equal(toLcuPerUsd(null, false), null);
  assert.equal(toLcuPerUsd(undefined, true), null);
});

test("computeOverUndervaluedPercent computes the percent difference between the actual and PPP rates", () => {
  const result = computeOverUndervaluedPercent(159.31, 97.08);
  assert.ok(Math.abs(result - 64.099) < 0.01);
});

test("computeOverUndervaluedPercent returns null when the PPP rate is zero", () => {
  assert.equal(computeOverUndervaluedPercent(100, 0), null);
});

test("computeOverUndervaluedPercent returns null for non-numeric inputs", () => {
  assert.equal(computeOverUndervaluedPercent(null, 97.08), null);
  assert.equal(computeOverUndervaluedPercent(159.31, null), null);
});

test("fetchWorldBankPpp requests the World Bank API with the given country codes and date range", async () => {
  const requestedUrls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requestedUrls.push(url.toString());
    return { ok: true, json: async () => [{ page: 1 }, []] };
  };

  try {
    await fetchWorldBankPpp(["JPN", "GBR"], 2011, 2026);
    assert.equal(requestedUrls.length, 1);
    assert.match(requestedUrls[0], /country\/JPN;GBR\//);
    assert.match(requestedUrls[0], /indicator\/PA\.NUS\.PPP/);
    assert.match(requestedUrls[0], /date=2011:2026/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchWorldBankPpp throws a clear error when the upstream response is not ok", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  try {
    await assert.rejects(() => fetchWorldBankPpp(["JPN"], 2011, 2026), /World Bank上流エラー: 503/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("PPP_JPY_CROSS_CURRENCIES lists exactly the 9 non-JPY target currencies, each compared directly against JPY", () => {
  const byCurrency = Object.fromEntries(PPP_JPY_CROSS_CURRENCIES.map((c) => [c.currency, c]));
  assert.equal(PPP_JPY_CROSS_CURRENCIES.length, 9);
  assert.deepEqual(
    Object.keys(byCurrency).sort(),
    ["AUD", "CAD", "CNY", "EUR", "GBP", "MXN", "NZD", "TRY", "ZAR"]
  );
  // EUR still uses Germany as the euro-area proxy, same as the USD-based comparison.
  assert.equal(byCurrency.EUR.iso3, "DEU");
  assert.match(byCurrency.EUR.note, /ドイツ/);
  assert.equal(byCurrency.GBP.note, null);
  assert.equal(byCurrency.NZD.note, null);
  assert.equal(byCurrency.TRY.note, null);
  assert.equal(byCurrency.MXN.note, null);
  assert.equal(byCurrency.ZAR.note, null);
});

test("PPP_JPY_CROSS_CURRENCIES pair labels and Yahoo symbols use the direct JPY-cross convention (e.g. EUR/JPY via EURJPY=X)", () => {
  const byCurrency = Object.fromEntries(PPP_JPY_CROSS_CURRENCIES.map((c) => [c.currency, c]));
  assert.equal(byCurrency.EUR.pair, "EUR/JPY");
  assert.equal(byCurrency.EUR.yahooSymbol, "EURJPY=X");
  assert.equal(byCurrency.GBP.pair, "GBP/JPY");
  assert.equal(byCurrency.GBP.yahooSymbol, "GBPJPY=X");
  assert.equal(byCurrency.CNY.pair, "CNY/JPY");
  assert.equal(byCurrency.CNY.yahooSymbol, "CNYJPY=X");
  assert.equal(byCurrency.AUD.pair, "AUD/JPY");
  assert.equal(byCurrency.AUD.yahooSymbol, "AUDJPY=X");
  assert.equal(byCurrency.CAD.pair, "CAD/JPY");
  assert.equal(byCurrency.CAD.yahooSymbol, "CADJPY=X");
  assert.equal(byCurrency.NZD.pair, "NZD/JPY");
  assert.equal(byCurrency.NZD.yahooSymbol, "NZDJPY=X");
  assert.equal(byCurrency.TRY.pair, "TRY/JPY");
  assert.equal(byCurrency.TRY.yahooSymbol, "TRYJPY=X");
  assert.equal(byCurrency.MXN.pair, "MXN/JPY");
  assert.equal(byCurrency.MXN.yahooSymbol, "MXNJPY=X");
  assert.equal(byCurrency.ZAR.pair, "ZAR/JPY");
  assert.equal(byCurrency.ZAR.yahooSymbol, "ZARJPY=X");
});

test("buildCrossPppByYear computes the base/quote ratio for years present in both maps", () => {
  const result = buildCrossPppByYear({ 2024: 94.462599, 2025: 97.08 }, { 2024: 0.700862, 2025: 0.70998 });
  assert.ok(Math.abs(result[2024] - 94.462599 / 0.700862) < 1e-9);
  assert.ok(Math.abs(result[2025] - 97.08 / 0.70998) < 1e-9);
});

test("buildCrossPppByYear excludes years present in only one of the two maps", () => {
  const result = buildCrossPppByYear({ 2023: 90, 2024: 95, 2025: 97 }, { 2024: 0.7 });
  assert.deepEqual(Object.keys(result), ["2024"]);
});

test("buildCrossPppByYear returns an empty map when there are no years in common", () => {
  assert.deepEqual(buildCrossPppByYear({ 2023: 90 }, { 2025: 0.7 }), {});
});
