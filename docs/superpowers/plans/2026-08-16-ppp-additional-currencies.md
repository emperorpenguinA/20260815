# PPP機能: 追加4通貨(NZD・TRY・MXN・ZAR) 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 既存のPPP(購買力平価)機能の対米ドル比較・対日本円比較の両方に、NZD(ニュージーランドドル)・TRY(トルコリラ)・MXN(メキシコペソ)・ZAR(南アフリカランド)の4通貨を追加する。

**Architecture:** 新しいアーキテクチャ・関数は不要。既存の設定配列`PPP_CURRENCIES`・`PPP_JPY_CROSS_CURRENCIES`にエントリを追加するだけで、既存のフェッチ・正規化・エラー分離・レンダリングのロジックがそのまま機能する。

**Tech Stack:** Cloudflare Workers(`worker/src/`)、`node:test`によるWorker側ユニットテスト。フロントエンド・新規依存パッケージの変更なし。

## Global Constraints

- 追加通貨: NZD・TRY・MXN・ZAR。対米ドル・対日本円の両方に追加する
- 対米ドルのYahooシンボルと向き(実データで確認済み): `NZDUSD=X`(逆数変換が必要、`invert: true`)、`TRY=X`・`MXN=X`・`ZAR=X`(そのまま使用、`invert: false`)
- 対日本円のYahooシンボル(実データで確認済み、いずれも直接クオートで逆数変換不要): `NZDJPY=X`・`TRYJPY=X`・`MXNJPY=X`・`ZARJPY=X`
- World Bank iso3コード: NZD→`NZL`、TRY→`TUR`、MXN→`MEX`、ZAR→`ZAF`
- 4通貨とも`note`は`null`(ユーロのような代表値の注記は不要)
- `worker/src/index.js`・フロントエンド(`js/ppp.js`・`index.html`・`css/style.css`)は変更不要(既存の実装が配列の長さに依存しない汎用的な作りになっているため)
- 新規npmパッケージは追加しない

---

## File Structure

- `worker/src/ppp.js`(変更): `PPP_CURRENCIES`・`PPP_JPY_CROSS_CURRENCIES`に4エントリずつ追加
- `worker/test/ppp.test.js`(変更): 上記の追加に対応するテストを更新
- `worker/test/index.test.js`(変更): `/api/ppp`集約テストのうち、通貨リストをハードコードしている2箇所を更新(他のテストは`PPP_CURRENCIES`/`PPP_JPY_CROSS_CURRENCIES`を動的に参照する作りのため変更不要)

---

### Task 1: 4通貨をPPP設定に追加

**Files:**
- Modify: `worker/src/ppp.js`
- Modify: `worker/test/ppp.test.js`
- Modify: `worker/test/index.test.js`

**Interfaces:**
- Consumes: なし(既存の`PPP_CURRENCIES`・`PPP_JPY_CROSS_CURRENCIES`という配列そのものへのエントリ追加)
- Produces: `PPP_CURRENCIES`が10エントリ、`PPP_JPY_CROSS_CURRENCIES`が9エントリになる(既存のエントリ構造・フィールドは変更しない)

- [ ] **Step 1: Write the failing tests**

`worker/test/ppp.test.js`の`"PPP_CURRENCIES lists exactly the 6 target currencies..."`テストを、以下の内容に置き換える(通貨数を10に、新4通貨のinvertフラグの検証を追加):

```js
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
```

`"PPP_CURRENCIES pair labels are all expressed..."`テストを、以下の内容に置き換える:

```js
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
```

同じファイルの`"PPP_JPY_CROSS_CURRENCIES lists exactly the 5 non-JPY target currencies..."`テストを、以下の内容に置き換える:

```js
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
```

`"PPP_JPY_CROSS_CURRENCIES pair labels and Yahoo symbols use the direct JPY-cross convention..."`テストの末尾(既存の`CAD`の検証の後)に追記:

```js
  assert.equal(byCurrency.NZD.pair, "NZD/JPY");
  assert.equal(byCurrency.NZD.yahooSymbol, "NZDJPY=X");
  assert.equal(byCurrency.TRY.pair, "TRY/JPY");
  assert.equal(byCurrency.TRY.yahooSymbol, "TRYJPY=X");
  assert.equal(byCurrency.MXN.pair, "MXN/JPY");
  assert.equal(byCurrency.MXN.yahooSymbol, "MXNJPY=X");
  assert.equal(byCurrency.ZAR.pair, "ZAR/JPY");
  assert.equal(byCurrency.ZAR.yahooSymbol, "ZARJPY=X");
```

`worker/test/index.test.js`の`"handlePpp aggregates all 6 currencies, converts EUR/GBP/AUD via reciprocal, and computes the over/undervaluation percent"`テスト全体を、以下の内容に置き換える(タイトルも変更し、新4通貨分のWorld Bank・Yahooフィクスチャと、それぞれのアサーションを追加):

```js
test("handlePpp aggregates all 10 currencies, converts EUR/GBP/AUD/NZD via reciprocal, and computes the over/undervaluation percent", async () => {
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
    { iso3: "NZL", date: 2025, value: 1.4730 },
    { iso3: "NZL", date: 2024, value: 1.4639 },
    { iso3: "TUR", date: 2025, value: 16.2036 },
    { iso3: "TUR", date: 2024, value: 11.5545 },
    { iso3: "MEX", date: 2025, value: 10.3290 },
    { iso3: "MEX", date: 2024, value: 9.9166 },
    { iso3: "ZAF", date: 2025, value: 7.4203 },
    { iso3: "ZAF", date: 2024, value: 7.4211 },
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
    "NZDUSD=X": fakeChartResponse("NZDUSD=X", "USD", [0.58, 0.585, 0.5894]),
    "TRY=X": fakeChartResponse("TRY=X", "TRY", [46, 47, 47.8605]),
    "MXN=X": fakeChartResponse("MXN=X", "MXN", [16.8, 16.9, 17.015]),
    "ZAR=X": fakeChartResponse("ZAR=X", "ZAR", [16.0, 16.1, 16.1664]),
    "NZDJPY=X": fakeChartResponse("NZDJPY=X", "JPY", [92, 93, 93.884]),
    "TRYJPY=X": fakeChartResponse("TRYJPY=X", "JPY", [3.2, 3.25, 3.278]),
    "MXNJPY=X": fakeChartResponse("MXNJPY=X", "JPY", [9.2, 9.3, 9.328]),
    "ZARJPY=X": fakeChartResponse("ZARJPY=X", "JPY", [9.7, 9.8, 9.843]),
  };
  globalThis.fetch = mockPppFetch({ worldBank, chartsBySymbol });

  try {
    const request = new Request("https://example.com/api/ppp");
    const response = await handler.fetch(request);
    const body = await response.json();

    assert.equal(body.indicators.length, 10);

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

    const nzd = body.indicators.find((i) => i.currency === "NZD");
    assert.equal(nzd.error, undefined);
    assert.equal(nzd.pair, "USD/NZD");
    // NZDUSD=X's last close is 0.5894 (USD per NZD); inverted, actual should be 1/0.5894.
    assert.ok(Math.abs(nzd.latestActual - 1 / 0.5894) < 1e-6);
    assert.equal(nzd.note, null);

    const tryUsd = body.indicators.find((i) => i.currency === "TRY");
    assert.equal(tryUsd.error, undefined);
    assert.equal(tryUsd.pair, "USD/TRY");
    // TRY=X is already TRY-per-USD; used directly, no inversion.
    assert.equal(tryUsd.latestActual, 47.8605);

    assert.equal(body.crossIndicators.length, 9);

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

    const nzdJpy = body.crossIndicators.find((i) => i.currency === "NZD");
    assert.equal(nzdJpy.error, undefined);
    assert.equal(nzdJpy.pair, "NZD/JPY");
    assert.equal(nzdJpy.latestActual, 93.884);
    // PPP-implied NZD/JPY = JPY's PPP factor ÷ NZD's PPP factor = 97.08 / 1.4730.
    assert.ok(Math.abs(nzdJpy.latestPpp - 97.08 / 1.473) < 1e-6);
    assert.equal(nzdJpy.note, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
```

`worker/test/index.test.js`の`"handlePpp marks every currency as failed when the World Bank request itself fails"`テストを、以下の内容に置き換える(通貨数の期待値だけを更新):

```js
test("handlePpp marks every currency as failed when the World Bank request itself fails", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockPppFetch({ worldBank: new Error("World Bank unreachable"), chartsBySymbol: {} });

  try {
    const request = new Request("https://example.com/api/ppp");
    const response = await handler.fetch(request);
    const body = await response.json();

    assert.equal(body.indicators.length, 10);
    assert.ok(body.indicators.every((i) => i.error === true));

    assert.equal(body.crossIndicators.length, 9);
    assert.ok(body.crossIndicators.every((i) => i.error === true));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
```

**注意**: `worker/test/index.test.js`の他のPPP関連テスト(`"handlePpp requests World Bank PPP data for the union of..."`・`"handlePpp isolates a per-currency chart failure..."`・`"handlePpp truncates points to the ?months= query param"`・`"handlePpp isolates a single JPY-cross currency's chart failure..."`・`"handlePpp truncates crossIndicators' points..."`)は、`PPP_CURRENCIES`・`PPP_JPY_CROSS_CURRENCIES`を直接参照してフィクスチャを動的に組み立てる作りになっており、通貨数のハードコードがないため、変更不要。

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && node --test test/ppp.test.js test/index.test.js`
Expected: FAIL — 通貨数の不一致(`assert.equal(PPP_CURRENCIES.length, 10)`が実際は6で失敗、など)

- [ ] **Step 3: Write the implementation**

`worker/src/ppp.js`の`PPP_CURRENCIES`配列の末尾(`CAD`のエントリの後、閉じ`]`の前)に追記:

```js
  { currency: "NZD", iso3: "NZL", yahooSymbol: "NZDUSD=X", pair: "USD/NZD", invert: true, note: null },
  { currency: "TRY", iso3: "TUR", yahooSymbol: "TRY=X", pair: "USD/TRY", invert: false, note: null },
  { currency: "MXN", iso3: "MEX", yahooSymbol: "MXN=X", pair: "USD/MXN", invert: false, note: null },
  { currency: "ZAR", iso3: "ZAF", yahooSymbol: "ZAR=X", pair: "USD/ZAR", invert: false, note: null },
```

`PPP_JPY_CROSS_CURRENCIES`配列の末尾(`CAD`のエントリの後、閉じ`]`の前)に追記:

```js
  { currency: "NZD", iso3: "NZL", yahooSymbol: "NZDJPY=X", pair: "NZD/JPY", note: null },
  { currency: "TRY", iso3: "TUR", yahooSymbol: "TRYJPY=X", pair: "TRY/JPY", note: null },
  { currency: "MXN", iso3: "MEX", yahooSymbol: "MXNJPY=X", pair: "MXN/JPY", note: null },
  { currency: "ZAR", iso3: "ZAF", yahooSymbol: "ZARJPY=X", pair: "ZAR/JPY", note: null },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && node --test test/*.test.js`
Expected: PASS — all tests green(既存の`/api/econ`関連テストも含め、影響を受けていないことを確認)

- [ ] **Step 5: Commit**

```bash
git add worker/src/ppp.js worker/test/ppp.test.js worker/test/index.test.js
git commit -m "feat: add NZD, TRY, MXN, ZAR to PPP comparisons"
```

---

### Task 2: 全体テスト・ブラウザ確認・デプロイ

このタスクはコード変更を伴わない、最終検証タスク。

- [ ] **Step 1: Worker側の全テストを実行**

Run: `cd worker && node --test test/*.test.js`
Expected: すべてPASS

- [ ] **Step 2: 全フロントエンドJSファイルの構文確認**

Run: `for f in js/*.js; do node --check "$f"; done`
Expected: エラーなし(このタスクではフロントエンドを変更していないが、念のため既存ファイルが壊れていないことを確認)

- [ ] **Step 3: ローカルサーバーでブラウザ確認**

Node製の静的サーバー(`.js`を`text/javascript`で返すもの)でプロジェクトルートを配信し、ブラウザで以下を確認する:

- 「対米ドル」セクションに10カード(既存6通貨+NZD・TRY・MXN・ZAR)が表示される
- 「対日本円」セクションに9カード(既存5通貨+NZD・TRY・MXN・ZAR)が表示される
- 新4通貨のカードもチャート(実勢実線・PPP破線)・ツールチップ・割安/割高の文言が既存カードと同様に表示される
- トルコリラのカードで、割安/割高%が大きな数値(100%超)になっていても表示崩れがない

- [ ] **Step 4: Cloudflare Workerへデプロイ**

Run: `cd worker && npx wrangler deploy`

- [ ] **Step 5: デプロイ後の実データ確認**

Run: `curl -s "https://investment-dashboard-proxy.investment-dashboard-as.workers.dev/api/ppp"`
Expected: `indicators`が10件・`crossIndicators`が9件返り、NZD・TRY・MXN・ZARに`error`が出ていないこと
