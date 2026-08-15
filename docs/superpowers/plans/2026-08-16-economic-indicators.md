# 経済指標(CPI・PPI)セクション Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ダッシュボードに、日本・米国のCPI(消費者物価指数)とPPI(企業物価指数・輸出物価指数・輸入物価指数)を前年同月比とグラフで比較できる「経済指標」セクションを追加する。

**Architecture:** Cloudflare Workerに新しいデータ取得層(`worker/src/econ.js`)を追加し、e-Stat API(日本CPI)・日本銀行 時系列統計データAPI(日本PPI・輸出入物価指数)・FRED API(米国CPI・PPI・輸出入物価指数)の3ソースを`/api/econ`エンドポイントに集約する。フロントエンドは既存の`renderSparkline`(chart.js)と`initTooltips`(tooltip.js)をそのまま再利用し、新しい`js/econ.js`でカードを描画する。

**Tech Stack:** 既存プロジェクトと同じ(Vanilla HTML/CSS/JS、Cloudflare Workers、`node:test`)。新規npm依存は追加しない。

## Global Constraints

- 新しいnpmパッケージ・ライブラリを追加しない (spec: 全体方針)
- e-Statの`appId`とFREDの`api_key`はコードにハードコードせず、Cloudflare Workersのシークレット(`ESTAT_APP_ID`、`FRED_API_KEY`)として渡す (spec: バックエンド設計)
- 日本銀行APIは認証不要。実装で誤ってappId/api_keyのような認証情報を要求するコードを書かない (spec: データソース)
- 8指標(日本4・米国4)はそれぞれ個別にエラー分離する。1つのAPIソース全体が落ちても他のソースの指標は表示され続ける (spec: エラーハンドリング)
- 購買力平価(PPP)は今回のスコープ外。実装しない (spec: スコープ)
- フロントエンドの自動テストは設けない。Workerのテストのみ、正規化ロジックを中心に単体テストする (spec: テスト方針)
- e-Statの`statsDataId`は、e-Stat未登録の状態では確定できない外部依存値のため、`worker/src/econ.js`内でプレースホルダー定数として定義し、デプロイ手順書に沿ってユーザー自身が確認・置き換える(既存の`js/config.js`の`WORKER_BASE_URL`と同じ扱い)

---

## ファイル構成

```
20260815/
├── worker/
│   ├── src/
│   │   ├── econ.js                # 新規: e-Stat/日銀/FREDの取得・正規化ロジック
│   │   └── index.js                # 変更: /api/econ エンドポイント追加、env引き回し
│   └── test/
│       └── econ.test.js            # 新規: econ.jsの単体テスト
├── js/
│   ├── api.js                      # 変更: fetchEconIndicators追加
│   ├── econ.js                     # 新規: 経済指標セクションの描画
│   └── glossary-terms.js           # 変更: CPI/PPI関連5用語を追加
├── index.html                      # 変更: 経済指標セクション追加
├── css/
│   └── style.css                   # 変更: 経済指標カード用の最小限のスタイル追加
└── docs/
    └── deploy-cloudflare.md        # 変更: e-Stat/FRED登録・シークレット設定手順を追記
```

---

### Task 1: Worker — 共通ヘルパー + 日本銀行API連携

**Files:**
- Create: `worker/src/econ.js`
- Create: `worker/test/econ.test.js`

**Interfaces:**
- Produces(Task 2・3・4が使う):
  - `computeYoyPercent(points: {date, value}[]): number | null` — 前年同月比(%)。13点未満、または12ヶ月前の値が0の場合は`null`
  - `takeRecentMonths(points: {date, value}[], months: number): {date, value}[]` — 末尾から`months`件を切り出す
  - `BOJ_SERIES: { ppiDomestic, ppiExport, ppiImport }` — 日銀の系列コード定数
  - `fetchBojPriceIndex(seriesCode: string, startDate: string, endDate: string): Promise<object>` — 日銀APIの生JSON
  - `normalizeBojPriceIndex(raw: object): { points: {date, value}[] }` — 生データが見つからない場合は`Error`をthrow

- [ ] **Step 1: 失敗するテストを書く**

`worker/test/econ.test.js`:

```js
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
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test worker/test/econ.test.js`
Expected: FAIL(`../src/econ.js`が存在しないためモジュール解決エラー)

- [ ] **Step 3: `worker/src/econ.js`を実装**

```js
const BOJ_DATA_BASE = "https://www.stat-search.boj.or.jp/api/v1/getDataCode";

// 日本銀行 企業物価指数(2020年基準)の系列コード。db=PR01 の getMetadata で確認済み。
export const BOJ_SERIES = {
  ppiDomestic: "PRCG20_2200000000",
  ppiExport: "PRCG20_2400000000",
  ppiImport: "PRCG20_2600000000",
};

export function computeYoyPercent(points) {
  if (!points || points.length < 13) return null;

  const latest = points[points.length - 1];
  const yearAgo = points[points.length - 13];
  if (typeof latest.value !== "number" || typeof yearAgo.value !== "number" || yearAgo.value === 0) {
    return null;
  }

  return ((latest.value - yearAgo.value) / yearAgo.value) * 100;
}

export function takeRecentMonths(points, months) {
  if (!points || points.length <= months) return points || [];
  return points.slice(points.length - months);
}

export async function fetchBojPriceIndex(seriesCode, startDate, endDate) {
  const url = `${BOJ_DATA_BASE}?format=json&lang=jp&db=PR01&startDate=${startDate}&endDate=${endDate}&code=${seriesCode}`;
  const res = await fetch(url);
  return res.json();
}

export function normalizeBojPriceIndex(raw) {
  const series = raw?.RESULTSET?.[0];
  if (!series) {
    throw new Error("日銀統計データが見つかりません");
  }

  const dates = series.VALUES?.SURVEY_DATES || [];
  const values = series.VALUES?.VALUES || [];

  const points = dates
    .map((yyyymm, i) => ({ date: toMonthString(yyyymm), value: values[i] }))
    .filter((p) => typeof p.value === "number");

  return { points };
}

function toMonthString(yyyymm) {
  const s = String(yyyymm);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}`;
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `node --test worker/test/econ.test.js`
Expected: PASS(8 tests)

- [ ] **Step 5: Commit**

```bash
git add worker/src/econ.js worker/test/econ.test.js
git commit -m "feat: add yoy/date-range helpers and BOJ price index integration"
```

---

### Task 2: Worker — e-Stat API連携(日本CPI)

**Files:**
- Modify: `worker/src/econ.js`(Task 1で作成したファイルに追記)
- Modify: `worker/test/econ.test.js`(Task 1のテストに追記)

**Interfaces:**
- Consumes: なし(Task 1のヘルパーとは独立)
- Produces(Task 4が使う):
  - `JAPAN_CPI_STATS_DATA_ID: string` — e-Statのプレースホルダー定数(デプロイ時にユーザーが実際の値に置き換える)
  - `fetchJapanCpi(appId: string, statsDataId: string): Promise<object>` — e-Stat APIの生JSON
  - `normalizeJapanCpi(raw: object): { points: {date, value}[] }` — データが見つからない場合は`Error`をthrow

- [ ] **Step 1: 失敗するテストを書く**

`worker/test/econ.test.js`の末尾に追記:

```js
import { fetchJapanCpi, normalizeJapanCpi } from "../src/econ.js";

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

test("fetchJapanCpi requests e-Stat's getStatsData with the given appId and statsDataId", async () => {
  const requestedUrls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requestedUrls.push(url.toString());
    return { json: async () => ({}) };
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
```

`import`文はファイル先頭にまとめる(既存の`import { computeYoyPercent, ... } from "../src/econ.js";`に`fetchJapanCpi, normalizeJapanCpi`を追加する形でよい。上記コード例では分かりやすさのため分けて書いているが、実際のファイルではimport文は1箇所にまとめること)。

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test worker/test/econ.test.js`
Expected: FAIL(`fetchJapanCpi`・`normalizeJapanCpi`が未定義)

- [ ] **Step 3: `worker/src/econ.js`に追記**

```js
const ESTAT_DATA_BASE = "https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData";

// e-Statの統計表ID(statsDataId)は、e-Statへのユーザー登録・appId取得後でないと
// 確認できない外部依存値。docs/deploy-cloudflare.md の手順に沿って実際の値に
// 置き換えること(js/config.js の WORKER_BASE_URL と同じ扱いのプレースホルダー)。
export const JAPAN_CPI_STATS_DATA_ID = "YOUR-ESTAT-STATS-DATA-ID";

export async function fetchJapanCpi(appId, statsDataId) {
  const url = `${ESTAT_DATA_BASE}?appId=${encodeURIComponent(appId)}&statsDataId=${encodeURIComponent(statsDataId)}&metaGetFlg=N&cntGetFlg=N`;
  const res = await fetch(url);
  return res.json();
}

export function normalizeJapanCpi(raw) {
  const rawValues = raw?.GET_STATS_DATA?.STATISTICAL_DATA?.DATA_INF?.VALUE;
  if (!rawValues) {
    throw new Error("消費者物価指数データが見つかりません");
  }

  const list = Array.isArray(rawValues) ? rawValues : [rawValues];

  const points = list
    .map((v) => ({ date: toEstatMonthString(v["@time"]), value: Number(v["$"]) }))
    .filter((p) => p.date !== null && !Number.isNaN(p.value))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { points };
}

function toEstatMonthString(time) {
  const match = /^(\d{4})(\d{2})/.exec(String(time ?? ""));
  if (!match) return null;
  return `${match[1]}-${match[2]}`;
}
```

Append this after the BOJ code from Task 1. Also update the file's top `import`/export listing is not needed here since these are plain `export`(no imports required beyond what Task 1 already has, if any — Task 1 has no imports).

- [ ] **Step 4: テストを実行して成功を確認**

Run: `node --test worker/test/econ.test.js`
Expected: PASS(14 tests total: 8 from Task 1 + 6 new)

- [ ] **Step 5: Commit**

```bash
git add worker/src/econ.js worker/test/econ.test.js
git commit -m "feat: add e-Stat integration for Japan CPI"
```

---

### Task 3: Worker — FRED API連携(米国CPI・PPI・輸出入物価指数)

**Files:**
- Modify: `worker/src/econ.js`(Task 1・2で作成したファイルに追記)
- Modify: `worker/test/econ.test.js`(既存テストに追記)

**Interfaces:**
- Consumes: なし
- Produces(Task 4が使う):
  - `FRED_SERIES: { cpi, ppiDomestic, ppiExport, ppiImport }` — FREDの`series_id`定数(`CPIAUCSL`, `PPIACO`, `IQ`, `IR`)
  - `fetchUsIndicator(seriesId: string, apiKey: string): Promise<object>` — FRED APIの生JSON
  - `normalizeUsIndicator(raw: object): { points: {date, value}[] }` — データが見つからない場合は`Error`をthrow

- [ ] **Step 1: 失敗するテストを書く**

`worker/test/econ.test.js`に追記(importは既存のimport文にまとめる):

```js
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
    return { json: async () => ({}) };
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
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test worker/test/econ.test.js`
Expected: FAIL(`normalizeUsIndicator`・`fetchUsIndicator`・`FRED_SERIES`が未定義)

- [ ] **Step 3: `worker/src/econ.js`に追記**

```js
const FRED_OBSERVATIONS_BASE = "https://api.stlouisfed.org/fred/series/observations";

// FRED(セントルイス連銀)の series_id。いずれも米国労働統計局(BLS)由来で
// 公開・安定している系列。
export const FRED_SERIES = {
  cpi: "CPIAUCSL",
  ppiDomestic: "PPIACO",
  ppiExport: "IQ",
  ppiImport: "IR",
};

export async function fetchUsIndicator(seriesId, apiKey) {
  const url = `${FRED_OBSERVATIONS_BASE}?series_id=${encodeURIComponent(seriesId)}&api_key=${encodeURIComponent(apiKey)}&file_type=json`;
  const res = await fetch(url);
  return res.json();
}

export function normalizeUsIndicator(raw) {
  const observations = raw?.observations;
  if (!observations || observations.length === 0) {
    throw new Error("米国の指標データが見つかりません");
  }

  const points = observations
    .map((o) => ({ date: typeof o.date === "string" ? o.date.slice(0, 7) : null, value: Number(o.value) }))
    .filter((p) => p.date !== null && !Number.isNaN(p.value));

  return { points };
}
```

Append this after the e-Stat code from Task 2. Update `worker/test/econ.test.js`'s top import to include `normalizeUsIndicator, fetchUsIndicator, FRED_SERIES` from `../src/econ.js`.

- [ ] **Step 4: テストを実行して成功を確認**

Run: `node --test worker/test/econ.test.js`
Expected: PASS(18 tests total: 14 from Tasks 1-2 + 4 new)

- [ ] **Step 5: Commit**

```bash
git add worker/src/econ.js worker/test/econ.test.js
git commit -m "feat: add FRED integration for US CPI/PPI indicators"
```

---

### Task 4: Worker — `/api/econ`エンドポイント実装

**Files:**
- Modify: `worker/src/index.js`

**Interfaces:**
- Consumes: `computeYoyPercent`, `takeRecentMonths`, `BOJ_SERIES`, `fetchBojPriceIndex`, `normalizeBojPriceIndex`, `JAPAN_CPI_STATS_DATA_ID`, `fetchJapanCpi`, `normalizeJapanCpi`, `FRED_SERIES`, `fetchUsIndicator`, `normalizeUsIndicator`(Task 1〜3、`worker/src/econ.js`)
- Produces(フロントエンドが呼び出すエンドポイント):
  - `GET /api/econ` → `{ indicators: ({ id, country, label, points, yoyPercent, latestDate } | { id, country, label, error: true, message })[] }`(8件、順序は日本4件→米国4件)

- [ ] **Step 1: `worker/src/index.js`のimportとfetchシグネチャを変更**

ファイル冒頭のimportに以下を追加:

```js
import {
  computeYoyPercent,
  takeRecentMonths,
  fetchBojPriceIndex,
  normalizeBojPriceIndex,
  BOJ_SERIES,
  fetchJapanCpi,
  normalizeJapanCpi,
  JAPAN_CPI_STATS_DATA_ID,
  fetchUsIndicator,
  normalizeUsIndicator,
  FRED_SERIES,
} from "./econ.js";
```

`export default { async fetch(request) {` を `export default { async fetch(request, env) {` に変更する(Cloudflare Workersのシークレットを`env`経由で受け取るため)。既存の`handleQuote`/`handleChart`/`handleSearch`の呼び出しはそのまま(これらは`env`を使わない)。

`/api/search`のルーティングの直後に以下を追加:

```js
    if (url.pathname === "/api/econ") {
      return handleEcon(env);
    }
```

- [ ] **Step 2: `handleEcon`関数を追加**

ファイル末尾(`fetchJapanSearchSupplement`関数の後)に追加:

```js
const ECON_RECENT_MONTHS = 36;

async function handleEcon(env) {
  const now = new Date();
  const endDate = formatYyyymm(now);
  const startDate = formatYyyymm(new Date(now.getFullYear(), now.getMonth() - ECON_RECENT_MONTHS, 1));

  const jobs = [
    {
      id: "jp-cpi",
      country: "JP",
      label: "消費者物価指数(CPI)",
      run: () => fetchJapanCpi(env.ESTAT_APP_ID, JAPAN_CPI_STATS_DATA_ID).then(normalizeJapanCpi),
    },
    {
      id: "jp-ppi-domestic",
      country: "JP",
      label: "国内企業物価指数(PPI)",
      run: () => fetchBojPriceIndex(BOJ_SERIES.ppiDomestic, startDate, endDate).then(normalizeBojPriceIndex),
    },
    {
      id: "jp-ppi-export",
      country: "JP",
      label: "輸出物価指数",
      run: () => fetchBojPriceIndex(BOJ_SERIES.ppiExport, startDate, endDate).then(normalizeBojPriceIndex),
    },
    {
      id: "jp-ppi-import",
      country: "JP",
      label: "輸入物価指数",
      run: () => fetchBojPriceIndex(BOJ_SERIES.ppiImport, startDate, endDate).then(normalizeBojPriceIndex),
    },
    {
      id: "us-cpi",
      country: "US",
      label: "消費者物価指数(CPI)",
      run: () => fetchUsIndicator(FRED_SERIES.cpi, env.FRED_API_KEY).then(normalizeUsIndicator),
    },
    {
      id: "us-ppi-domestic",
      country: "US",
      label: "生産者物価指数(PPI)",
      run: () => fetchUsIndicator(FRED_SERIES.ppiDomestic, env.FRED_API_KEY).then(normalizeUsIndicator),
    },
    {
      id: "us-ppi-export",
      country: "US",
      label: "輸出物価指数",
      run: () => fetchUsIndicator(FRED_SERIES.ppiExport, env.FRED_API_KEY).then(normalizeUsIndicator),
    },
    {
      id: "us-ppi-import",
      country: "US",
      label: "輸入物価指数",
      run: () => fetchUsIndicator(FRED_SERIES.ppiImport, env.FRED_API_KEY).then(normalizeUsIndicator),
    },
  ];

  const indicators = await Promise.all(
    jobs.map(async (job) => {
      try {
        const { points: rawPoints } = await job.run();
        const points = takeRecentMonths(rawPoints, ECON_RECENT_MONTHS);
        return {
          id: job.id,
          country: job.country,
          label: job.label,
          points,
          yoyPercent: computeYoyPercent(points),
          latestDate: points.length > 0 ? points[points.length - 1].date : null,
        };
      } catch (err) {
        return { id: job.id, country: job.country, label: job.label, error: true, message: err.message };
      }
    })
  );

  return jsonResponse({ indicators });
}

function formatYyyymm(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}${month}`;
}
```

- [ ] **Step 3: エンドポイントの挙動を確認するテストを書く**

`worker/test/index.test.js`の末尾に追記(importに`handler`は既存のものを使用):

```js
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
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `node --test worker/test/yahoo.test.js worker/test/index.test.js worker/test/econ.test.js`
Expected: PASS(全テスト、既存分を含めて壊れていないこと)

- [ ] **Step 5: Commit**

```bash
git add worker/src/index.js worker/test/index.test.js
git commit -m "feat: add /api/econ endpoint aggregating CPI/PPI indicators"
```

---

### Task 5: フロントエンド — 経済指標セクション(用語集・API連携・描画・スタイル)

**Files:**
- Modify: `js/glossary-terms.js`
- Modify: `js/api.js`
- Create: `js/econ.js`
- Modify: `index.html`
- Modify: `css/style.css`

**Interfaces:**
- Consumes: `renderSparkline`(Task 6以前、`js/chart.js`)、`initTooltips`(`js/tooltip.js`)、`WORKER_BASE_URL`経由の`getJson`パターン(`js/api.js`)
- Produces: なし(UIの末端)

- [ ] **Step 1: `js/glossary-terms.js`に5用語を追記**

`GLOSSARY_TERMS`配列の末尾(`watchlist`エントリの後、配列を閉じる`]`の直前)に追記:

```js
  {
    id: "cpi",
    category: "経済指標",
    term: "CPI(消費者物価指数)",
    short: "家計が購入する商品・サービスの価格水準を示す指標。物価の変動(インフレ・デフレ)を測る代表的な指標。",
    description:
      "CPI(Consumer Price Index、消費者物価指数)は、一般家庭が購入する商品やサービスの価格水準を指数化したものです。前年同月比のプラスは物価上昇(インフレ)、マイナスは物価下落(デフレ)を意味し、中央銀行の金融政策判断にも使われる代表的な経済指標です。",
  },
  {
    id: "ppi",
    category: "経済指標",
    term: "PPI(企業物価指数/生産者物価指数)",
    short: "企業間で取引される商品の価格水準を示す指標。消費者に届く前の、生産・卸売段階での物価動向を表す。",
    description:
      "PPI(Producer Price Index)は、企業間で取引される商品(原材料・中間財・最終財)の価格水準を指数化したものです。日本では日本銀行が「企業物価指数」として公表しています。消費者物価指数(CPI)より一足早く物価動向の変化を捉えられることが多く、CPIの先行指標として注目されます。",
  },
  {
    id: "export-price-index",
    category: "経済指標",
    term: "輸出物価指数",
    short: "自国から輸出される商品の価格水準を示す指標。為替レートの影響を受けやすい。",
    description:
      "輸出物価指数は、自国から海外へ輸出される商品の価格水準を指数化したものです。為替レートの変動(円安・円高)の影響を強く受け、例えば円安が進むと円建ての輸出物価指数は上昇しやすくなります。",
  },
  {
    id: "import-price-index",
    category: "経済指標",
    term: "輸入物価指数",
    short: "海外から輸入される商品の価格水準を示す指標。原油や穀物などの国際価格・為替の影響を強く受ける。",
    description:
      "輸入物価指数は、海外から自国へ輸入される商品の価格水準を指数化したものです。原油や穀物などの国際商品価格や為替レートの影響を強く受け、輸入物価の上昇は国内の生産コスト上昇を通じて、後に国内企業物価指数(PPI)や消費者物価指数(CPI)にも波及することがあります。",
  },
  {
    id: "yoy-change",
    category: "経済指標",
    term: "前年同月比",
    short: "1年前の同じ月と比べた変化率(%)。季節による変動の影響を受けにくく、経済指標でよく使われる。",
    description:
      "前年同月比は、ある月の値を1年前の同じ月の値と比較した変化率(%)です。「今月 ÷ 1年前の同月 × 100 − 100」で計算します。季節による一時的な変動(季節性)の影響を受けにくいため、CPI・PPIなどの経済指標では月次の単純な前月比よりも前年同月比がよく使われます。",
  },
```

- [ ] **Step 2: `js/api.js`に`fetchEconIndicators`を追加**

`js/api.js`の`searchSymbols`関数の後に追記:

```js
export function fetchEconIndicators() {
  return getJson("/api/econ");
}
```

- [ ] **Step 3: `js/econ.js`を作成**

```js
import { fetchEconIndicators } from "./api.js";
import { renderSparkline } from "./chart.js";
import { initTooltips } from "./tooltip.js";

const TOOLTIP_TERM_BY_ID = {
  "jp-cpi": "cpi",
  "jp-ppi-domestic": "ppi",
  "jp-ppi-export": "export-price-index",
  "jp-ppi-import": "import-price-index",
  "us-cpi": "cpi",
  "us-ppi-domestic": "ppi",
  "us-ppi-export": "export-price-index",
  "us-ppi-import": "import-price-index",
};

const gridEl = document.getElementById("econ-grid");

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }
  return value.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderIndicatorCard(indicator) {
  const card = document.createElement("article");
  card.className = "card";
  card.id = `econ-${indicator.id}`;

  if (indicator.error) {
    card.innerHTML = `
      <div class="card-header">
        <div>
          <div class="card-title">${escapeHtml(indicator.label)}</div>
          <div class="card-symbol">${escapeHtml(indicator.country)}</div>
        </div>
      </div>
      <div class="card-error">
        取得できませんでした
        <button class="retry-button">再試行</button>
      </div>
    `;
    card.querySelector(".retry-button").addEventListener("click", loadEconIndicators);
    return card;
  }

  const changeValue = indicator.yoyPercent ?? 0;
  const changeClass = changeValue >= 0 ? "positive" : "negative";
  const changeSign = changeValue >= 0 ? "+" : "";
  const termId = TOOLTIP_TERM_BY_ID[indicator.id] || "cpi";
  const yoyText = indicator.yoyPercent === null ? "-" : `${changeSign}${formatNumber(indicator.yoyPercent)}%`;

  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">${escapeHtml(indicator.label)}</div>
        <div class="card-symbol">${escapeHtml(indicator.country)}</div>
      </div>
    </div>
    <div class="card-price ${changeClass}">
      ${yoyText}
      <button class="tooltip-icon" data-term="${termId}" aria-label="${escapeHtml(indicator.label)}とは">?</button>
    </div>
    <div class="card-symbol">前年同月比・${escapeHtml(indicator.latestDate || "-")}時点</div>
    <div class="card-chart"></div>
  `;

  const chartContainer = card.querySelector(".card-chart");
  const points = (indicator.points || []).map((p) => ({ date: p.date, close: p.value }));
  if (points.length > 0) {
    renderSparkline(chartContainer, points);
  }

  initTooltips(card);
  return card;
}

async function loadEconIndicators() {
  gridEl.innerHTML = "読み込み中...";

  let response;
  try {
    response = await fetchEconIndicators();
  } catch {
    gridEl.innerHTML = `<div class="card-error">経済指標を取得できませんでした</div>`;
    return;
  }

  gridEl.innerHTML = "";
  for (const indicator of response.indicators) {
    gridEl.appendChild(renderIndicatorCard(indicator));
  }
}

loadEconIndicators();
```

- [ ] **Step 4: `index.html`に経済指標セクションを追加**

`</main>`の直前、`<div id="watchlist-grid" class="watchlist-grid"></div>`の後に追加:

```html
  <h2 class="section-heading">経済指標(CPI・PPI)</h2>
  <div id="econ-grid" class="watchlist-grid"></div>
```

`</body>`直前の`<script type="module" src="js/dashboard.js"></script>`の後に追加:

```html
<script type="module" src="js/econ.js"></script>
```

- [ ] **Step 5: `css/style.css`に経済指標カード用のスタイルを追加**

ファイル末尾に追加:

```css
.section-heading {
  font-size: 1.1rem;
  margin: 32px 0 16px;
}

.card-price.positive {
  color: var(--color-positive);
}

.card-price.negative {
  color: var(--color-negative);
}
```

- [ ] **Step 6: 構文チェック**

Run: `node --check js/api.js`
Run: `node --check js/econ.js`
Run: `node --check js/glossary-terms.js`
Expected: いずれも出力なし、終了コード0

- [ ] **Step 7: ローカルサーバーで確認**

```bash
npx serve .
```

`http://localhost:3000/index.html`を開き、以下を確認する(この環境にWorkerのシークレットが未設定の場合、8枚とも「取得できませんでした」+再試行ボタンが表示されるはずで、それ自体は正しい挙動):
- 「経済指標(CPI・PPI)」の見出しが表示される
- 8枚のカード(日本4・米国4)が並ぶ
- エラー時、各カードに「取得できませんでした」+再試行ボタンが出る
- `http://localhost:3000/glossary.html`を開き、「経済指標」カテゴリにCPI・PPI・輸出物価指数・輸入物価指数・前年同月比の5項目が表示される

- [ ] **Step 8: Commit**

```bash
git add js/glossary-terms.js js/api.js js/econ.js index.html css/style.css
git commit -m "feat: add economic indicators (CPI/PPI) section to the dashboard"
```

---

### Task 6: ドキュメント — e-Stat/FRED登録・シークレット設定手順

**Files:**
- Modify: `docs/deploy-cloudflare.md`

**Interfaces:**
- Consumes: なし
- Produces: なし(ドキュメントのみ)

- [ ] **Step 1: `docs/deploy-cloudflare.md`に手順を追記**

既存の「## 注意事項」セクションの直前に、新しいセクションとして挿入:

```markdown
## 経済指標(CPI・PPI)機能を使うための追加設定

経済指標セクションは、日本銀行のAPI(認証不要)に加えて、e-Stat(日本CPI)・FRED(米国CPI・PPI・輸出入物価指数)という2つの外部APIを使う。どちらも無料だが、事前にユーザー登録してキーを取得し、Cloudflare Workersのシークレットとして設定する必要がある。この設定を行わない場合、日本のPPI・輸出物価指数・輸入物価指数(日銀API、認証不要)は表示されるが、日本のCPIと米国の4指標はエラー表示になる。

### 1. e-Stat(政府統計の総合窓口)に登録し、appIdを取得する

1. https://www.e-stat.go.jp/mypage/user/preregister0 からユーザー登録する(無料)
2. ログイン後、マイページの「API機能(アプリケーションID発行)」からアプリケーションIDを発行する
3. e-Statのサイト(https://www.e-stat.go.jp/stat-search?query=消費者物価指数)で「2020年基準消費者物価指数」(または最新の基準年のもの)から「全国」「総合指数」の月次データを探し、そのページのAPI案内に表示される`statsDataId`を控える
4. `worker/src/econ.js`の`JAPAN_CPI_STATS_DATA_ID`定数を、控えた値に書き換える

   ```js
   export const JAPAN_CPI_STATS_DATA_ID = "実際のstatsDataIdに置き換える";
   ```

### 2. FRED(セントルイス連邦準備銀行)に登録し、APIキーを取得する

1. https://fred.stlouisfed.org/ でアカウントを作成する(無料)
2. ログイン後、アカウント設定の「API Keys」から新しいAPIキーを発行する

### 3. Cloudflare Workersにシークレットとして登録する

`worker/`ディレクトリで以下を実行する(それぞれ実行後、値の入力を求められる):

```bash
npx wrangler secret put ESTAT_APP_ID
npx wrangler secret put FRED_API_KEY
```

登録後、`npx wrangler deploy`を再実行してWorkerに反映する。

### 4. 日本銀行APIについて

日本銀行の時系列統計データAPIは登録・認証が不要なため、追加設定は不要。
```

- [ ] **Step 2: Commit**

```bash
git add docs/deploy-cloudflare.md
git commit -m "docs: add e-Stat/FRED registration and secrets setup steps"
```
