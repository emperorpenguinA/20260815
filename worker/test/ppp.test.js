import test from "node:test";
import assert from "node:assert/strict";
import {
  PPP_CURRENCIES,
  fetchWorldBankPpp,
  normalizeWorldBankPpp,
  latestPppEntry,
  forwardFillPpp,
  toLcuPerUsd,
  computeOverUndervaluedPercent,
} from "../src/ppp.js";

test("PPP_CURRENCIES lists exactly the 6 target currencies with the expected invert flags", () => {
  const byCurrency = Object.fromEntries(PPP_CURRENCIES.map((c) => [c.currency, c]));
  assert.equal(PPP_CURRENCIES.length, 6);
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
