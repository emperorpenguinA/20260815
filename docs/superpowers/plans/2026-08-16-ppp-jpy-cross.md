# PPP機能: 日本円基準の比較 追加 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 既存のPPP(購買力平価)機能に、日本円を基準にした5通貨(EUR・GBP・CNY・AUD・CAD)との比較を追加する。対米ドルの既存比較はそのまま残す。

**Architecture:** 新規の外部API呼び出しは行わない。既存の`/api/ppp`が1回のリクエストで取得しているWorld BankのPPPデータ(6通貨分)を再利用し、日本円と対象通貨のPPP変換係数の比率から理論レートを導出する。実勢レートはYahoo Financeの直接クロスシンボル(`EURJPY=X`等)を新たに使う。

**Tech Stack:** Cloudflare Workers(`worker/src/`)、Vanilla JS ES Modules(`js/`)、`node:test`によるWorker側ユニットテスト。既存パターンを踏襲し新規依存パッケージは追加しない。

## Global Constraints

- 対象: EUR・GBP・CNY・AUD・CADの対日本円比較(JPY自身との比較は対象外)。既存の対米ドル比較(JPY・EUR・GBP・CNY・AUD・CAD)は変更しない
- PPP理論レート = 日本円のPPP変換係数 ÷ 対象通貨のPPP変換係数。既存のWorld Bank APIレスポンス(1回のリクエストで取得済み)を再利用し、新規リクエストは追加しない
- 実勢レートはYahooの直接クロスシンボル(`EURJPY=X`・`GBPJPY=X`・`CNYJPY=X`・`AUDJPY=X`・`CADJPY=X`)。実データで確認済み、いずれも「1外貨=何円」の向きでそのまま使え、逆数変換は不要
- ユーロは既存と同じくドイツの数値を代表値として使い、同じ注記文言を引き継ぐ
- 割安/割高の文言は常に日本円を主語にする。対米ドルの文言は変更しない
- 期間選択は既存の`ppp-period-selector`をそのまま共有する(新しい選択UIは追加しない)
- 新規CSSクラスは追加しない(既存の`.subsection-heading`・`.econ-grid`を再利用)
- 新規npmパッケージは追加しない

---

## File Structure

- `worker/src/ppp.js`(変更): `PPP_JPY_CROSS_CURRENCIES`設定と`buildCrossPppByYear`関数を追加
- `worker/test/ppp.test.js`(変更): 上記の単体テストを追加
- `worker/src/index.js`(変更): `handlePpp`を、既存の6通貨分の処理を`buildPppIndicator`ヘルパーに切り出したうえで、新たに`crossIndicators`を組み立てる`buildJpyCrossIndicator`ヘルパーを追加
- `worker/test/index.test.js`(変更): `crossIndicators`のテストを追加
- `js/ppp.js`(変更): `renderPppCard`に主語・比較対象を渡す引数を追加し、対日本円グリッドの描画処理を追加
- `index.html`(変更): 「対米ドル」「対日本円」の見出しと、対日本円用グリッド`ppp-jpy-grid`を追加

---

### Task 1: 日本円基準のPPP計算ロジック

**Files:**
- Modify: `worker/src/ppp.js`
- Modify: `worker/test/ppp.test.js`

**Interfaces:**
- Consumes: なし(このタスクは独立した純粋関数・設定の追加のみ)
- Produces:
  - `PPP_JPY_CROSS_CURRENCIES: Array<{currency: string, iso3: string, yahooSymbol: string, pair: string, note: string|null}>`
  - `function buildCrossPppByYear(baseByYear: Record<string, number>, quoteByYear: Record<string, number>): Record<string, number>` — 両方の年次マップに共通する年だけを対象に`base÷quote`の比率マップを返す

- [ ] **Step 1: Write the failing tests**

`worker/test/ppp.test.js`の末尾(既存のimport文に`PPP_JPY_CROSS_CURRENCIES`・`buildCrossPppByYear`を追加したうえで)に追記:

```js
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
```

(上記は既存のimport文を書き換えるものなので、ファイル先頭の既存importブロックを丸ごとこの内容に置き換える。)

ファイル末尾に追記:

```js
test("PPP_JPY_CROSS_CURRENCIES lists exactly the 5 non-JPY target currencies, each compared directly against JPY", () => {
  const byCurrency = Object.fromEntries(PPP_JPY_CROSS_CURRENCIES.map((c) => [c.currency, c]));
  assert.equal(PPP_JPY_CROSS_CURRENCIES.length, 5);
  assert.deepEqual(Object.keys(byCurrency).sort(), ["AUD", "CAD", "CNY", "EUR", "GBP"]);
  // EUR still uses Germany as the euro-area proxy, same as the USD-based comparison.
  assert.equal(byCurrency.EUR.iso3, "DEU");
  assert.match(byCurrency.EUR.note, /ドイツ/);
  assert.equal(byCurrency.GBP.note, null);
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && node --test test/ppp.test.js`
Expected: FAIL — `PPP_JPY_CROSS_CURRENCIES`/`buildCrossPppByYear` is not exported from `../src/ppp.js`

- [ ] **Step 3: Write the implementation**

`worker/src/ppp.js`の末尾に追記:

```js
// 対米ドル比較のEURと同じく、World BankのEMU集計にPA.NUS.PPPがないため
// ドイツを代表値として使う。Yahooのクロスシンボルは全て「1外貨=何円」の
// 直接クオートで返る(実データで確認済み)ため、対米ドル比較のEUR/GBP/AUDと
// 違い逆数変換は不要。
export const PPP_JPY_CROSS_CURRENCIES = [
  {
    currency: "EUR",
    iso3: "DEU",
    yahooSymbol: "EURJPY=X",
    pair: "EUR/JPY",
    note: "ユーロ圏の代表値としてドイツの数値を使用",
  },
  { currency: "GBP", iso3: "GBR", yahooSymbol: "GBPJPY=X", pair: "GBP/JPY", note: null },
  { currency: "CNY", iso3: "CHN", yahooSymbol: "CNYJPY=X", pair: "CNY/JPY", note: null },
  { currency: "AUD", iso3: "AUS", yahooSymbol: "AUDJPY=X", pair: "AUD/JPY", note: null },
  { currency: "CAD", iso3: "CAN", yahooSymbol: "CADJPY=X", pair: "CAD/JPY", note: null },
];

// 日本円(base)と対象通貨(quote)、両方のPPP変換係数がそろっている年だけを
// 対象に、base÷quoteの比率を年ごとに計算する。forwardFillPppにそのまま
// 渡せる{年: 値}の形で返す。
export function buildCrossPppByYear(baseByYear, quoteByYear) {
  const result = {};
  for (const year of Object.keys(baseByYear)) {
    if (!(year in quoteByYear)) continue;
    result[year] = baseByYear[year] / quoteByYear[year];
  }
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && node --test test/ppp.test.js`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add worker/src/ppp.js worker/test/ppp.test.js
git commit -m "feat: add JPY-cross PPP ratio calculation"
```

---

### Task 2: `/api/ppp`にcrossIndicatorsを追加

**Files:**
- Modify: `worker/src/index.js`
- Modify: `worker/test/index.test.js`

**Interfaces:**
- Consumes (Task 1、`worker/src/ppp.js`): `PPP_JPY_CROSS_CURRENCIES`, `buildCrossPppByYear(baseByYear, quoteByYear)`
- Consumes (既存、変更なし): `PPP_CURRENCIES`, `fetchWorldBankPpp`, `normalizeWorldBankPpp`, `latestPppEntry`, `forwardFillPpp`, `toLcuPerUsd`, `computeOverUndervaluedPercent`, `fetchChart`, `normalizeChart`, `takeRecentMonths`
- Produces: `/api/ppp`のレスポンスに`crossIndicators`配列を追加。各要素は`{ currency, pair, points: [{date, actual, ppp}], latestActual, latestPpp, pppYear, overUndervaluedPercent, note }`(エラー時は`{ currency, pair, error: true, message }`)

- [ ] **Step 1: Write the failing tests**

`worker/test/index.test.js`の先頭のimport文に`PPP_JPY_CROSS_CURRENCIES`を追加する:

```js
import {
  PPP_CURRENCIES,
  PPP_JPY_CROSS_CURRENCIES,
} from "../src/ppp.js";
```

既存のテスト`"handlePpp aggregates all 6 currencies, converts EUR/GBP/AUD via reciprocal, and computes the over/undervaluation percent"`を、以下の内容に置き換える(`chartsBySymbol`に5つのJPYクロスシンボルを追加し、`crossIndicators`の検証を追加しただけで、既存の`indicators`側のアサーションは変更しない):

```js
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
```

既存のテスト`"handlePpp marks every currency as failed when the World Bank request itself fails"`を、以下の内容に置き換える(`crossIndicators`側の全滅も検証するアサーションを追加しただけ):

```js
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
```

ファイル末尾(既存の`"handlePpp truncates points to the ?months= query param"`テストの後)に追記:

```js
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
```

**注意**: 上記フィクスチャで`PPP_CURRENCIES`の通貨コード(JPY・EUR・GBP・CNY・AUD・CAD)と`PPP_JPY_CROSS_CURRENCIES`の通貨コード(EUR・GBP・CNY・AUD・CAD)が重複するため、`fakeWorldBankResponse`に渡す配列にはJPYが1回、他の5通貨も1回だけ登場するようにする(`[...PPP_CURRENCIES, ...PPP_JPY_CROSS_CURRENCIES]`は同じ`iso3`が重複して並ぶ形になるが、`fakeWorldBankResponse`はそのまま複数行として`entries.map`で展開するだけなので、重複していても`normalizeWorldBankPpp`が同じ値を上書きするだけで問題は起きない)。

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && node --test test/index.test.js`
Expected: FAIL — `body.crossIndicators` is `undefined`

- [ ] **Step 3: Write the implementation**

`worker/src/index.js`の先頭のimport文を、以下の内容に置き換える:

```js
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
```

既存の`handlePpp`関数全体を、以下の内容に置き換える:

```js
async function handlePpp(months = MONTHS_DEFAULT) {
  const now = new Date();
  const endYear = now.getFullYear();
  const startYear = endYear - 15; // 10年(120ヶ月)の最大選択期間 + 予備で十分な幅

  let pppRaw;
  let pppFetchError = null;
  try {
    pppRaw = await fetchWorldBankPpp(
      PPP_CURRENCIES.map((c) => c.iso3),
      startYear,
      endYear
    );
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && node --test test/*.test.js`
Expected: PASS — all tests green (既存の`/api/econ`関連テストも含め、`buildPppIndicator`への切り出しで壊れていないことを確認)

- [ ] **Step 5: Commit**

```bash
git add worker/src/index.js worker/test/index.test.js
git commit -m "feat: add JPY-cross comparisons to /api/ppp response"
```

---

### Task 3: フロントエンドの対円カード描画とHTML配線

**Files:**
- Modify: `js/ppp.js`
- Modify: `index.html`

**Interfaces:**
- Consumes: `/api/ppp`のレスポンスの新規`crossIndicators`配列(Task 2)。各要素の形は既存の`indicators`要素と同じ(`{currency, pair, points, latestActual, latestPpp, pppYear, overUndervaluedPercent, note}`または`{currency, pair, error, message}`)
- Produces: なし(このタスクはUI表示のみ)

- [ ] **Step 1: `js/ppp.js`を変更**

`const periodSelectorEl = document.getElementById("ppp-period-selector");`の直後に追記:

```js
const jpyGridEl = document.getElementById("ppp-jpy-grid");
```

既存の`renderPppCard(indicator)`関数全体を、以下の内容に置き換える:

```js
function renderPppCard(indicator, subjectCurrency, counterCurrency) {
  const card = document.createElement("article");
  card.className = "card";
  card.id = `ppp-${indicator.pair.replace("/", "-")}`;

  if (indicator.error) {
    card.innerHTML = `
      <div class="card-header">
        <div>
          <div class="card-title">${escapeHtml(indicator.pair)}</div>
        </div>
      </div>
      <div class="card-error">
        取得できませんでした
        <button class="retry-button">再試行</button>
      </div>
    `;
    card.querySelector(".retry-button").addEventListener("click", loadPppIndicators);
    return card;
  }

  const changeValue = indicator.overUndervaluedPercent;
  const changeClass = typeof changeValue === "number" ? (changeValue >= 0 ? "positive" : "negative") : "";
  const direction = typeof changeValue === "number" ? (changeValue >= 0 ? "割安" : "割高") : null;
  const valuationText =
    direction === null
      ? "-"
      : counterCurrency
        ? `${subjectCurrency}は${counterCurrency}に対し理論値より${formatNumber(Math.abs(changeValue))}%${direction}`
        : `${subjectCurrency}は理論値より${formatNumber(Math.abs(changeValue))}%${direction}`;

  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">${escapeHtml(indicator.pair)}</div>
      </div>
    </div>
    <div class="card-chart"></div>
    <div class="card-chart-caption">
      実勢 ${formatNumber(indicator.latestActual)} / PPP ${formatNumber(indicator.latestPpp)}(${indicator.pppYear}年時点)
    </div>
    <div class="card-price ${changeClass}">
      ${valuationText}
      <button class="tooltip-icon" data-term="ppp" aria-label="購買力平価(PPP)とは">?</button>
    </div>
    ${indicator.note ? `<div class="card-note">${escapeHtml(indicator.note)}</div>` : ""}
  `;

  const chartContainer = card.querySelector(".card-chart");
  if (indicator.points && indicator.points.length > 0) {
    renderComparisonChart(chartContainer, indicator.points);
  }

  initTooltips(card);
  return card;
}
```

既存の`loadPppIndicators`関数全体を、以下の内容に置き換える:

```js
async function loadPppIndicators() {
  gridEl.innerHTML = "読み込み中...";
  jpyGridEl.innerHTML = "読み込み中...";

  let response;
  try {
    response = await fetchPpp(selectedMonths);
  } catch {
    gridEl.innerHTML = `<div class="card-error">購買力平価を取得できませんでした</div>`;
    jpyGridEl.innerHTML = "";
    return;
  }

  gridEl.innerHTML = "";
  for (const indicator of response.indicators) {
    gridEl.appendChild(renderPppCard(indicator, indicator.currency, null));
  }

  jpyGridEl.innerHTML = "";
  for (const indicator of response.crossIndicators) {
    jpyGridEl.appendChild(renderPppCard(indicator, "JPY", indicator.currency));
  }
}
```

- [ ] **Step 2: `index.html`を変更**

`<div id="ppp-grid" class="econ-grid"></div>`の行を、以下の内容に置き換える:

```html
  <h4 class="subsection-heading">対米ドル</h4>
  <div id="ppp-grid" class="econ-grid"></div>
  <h4 class="subsection-heading">対日本円</h4>
  <div id="ppp-jpy-grid" class="econ-grid"></div>
```

- [ ] **Step 3: Syntax-check**

Run: `node --check js/ppp.js`
Expected: no output (success)

- [ ] **Step 4: Commit**

```bash
git add js/ppp.js index.html
git commit -m "feat: render JPY-cross PPP comparison cards"
```

---

### Task 4: 全体テスト・ブラウザ確認・デプロイ

このタスクはコード変更を伴わない、最終検証タスク。

- [ ] **Step 1: Worker側の全テストを実行**

Run: `cd worker && node --test test/*.test.js`
Expected: すべてPASS

- [ ] **Step 2: 全フロントエンドJSファイルの構文確認**

Run: `for f in js/*.js; do node --check "$f"; done`
Expected: エラーなし

- [ ] **Step 3: ローカルサーバーでブラウザ確認**

Node製の静的サーバー(`.js`を`text/javascript`で返すもの)でプロジェクトルートを配信し、ブラウザで以下を確認する:

- 「購買力平価(PPP)」セクション内に「対米ドル」見出し・6カード、続けて「対日本円」見出し・5カード(EUR/JPY・GBP/JPY・CNY/JPY・AUD/JPY・CAD/JPY)が表示される
- 対円カードの割安/割高の文言が「JPYは{対象通貨}に対し理論値より○%割安/割高」の形式で、常にJPYが主語になっている
- 対円カードでもチャート(実勢実線・PPP破線)・ツールチップ・EURの注記が対米ドルカードと同様に表示される
- 期間選択(1年/3年/5年/10年)を切り替えると、対米ドル・対円の両方のカードが連動して更新される

- [ ] **Step 4: Cloudflare Workerへデプロイ**

Run: `cd worker && npx wrangler deploy`

- [ ] **Step 5: デプロイ後の実データ確認**

Run: `curl -s "https://investment-dashboard-proxy.investment-dashboard-as.workers.dev/api/ppp"`
Expected: `crossIndicators`に5通貨分のデータが返り、`error`が出ていないこと。日本円が他通貨に対して大幅に割安と出ることが多い(既存の対米ドル比較の傾向と整合するか目視で確認)
