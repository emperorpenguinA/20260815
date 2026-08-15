# 投資動向ダッシュボード Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 株価指数・個別株・為替の動向をスマホでも見やすく確認でき、用語解説も備えたウェブページ(GitHub Pages + Cloudflare Workers)を構築する。

**Architecture:** ビルド不要の Vanilla HTML/CSS/JS をGitHub Pagesで配信し、Yahoo Finance非公式APIへのCORSプロキシとしてCloudflare Workersを1本挟む。ウォッチリストはブラウザの `localStorage` にのみ保存し、サーバー側DBは持たない。

**Tech Stack:** HTML / CSS / Vanilla JavaScript(ESモジュール、フレームワーク不使用)、Cloudflare Workers(ESモジュール形式、外部npm依存なし)、テストはNode.js標準の `node:test`。

## Global Constraints

- 新しいnpmパッケージ・ライブラリを `package.json` に追加しない。Cloudflareへのデプロイは `npx wrangler`(一時実行、依存追加なし)を使う (spec: デプロイ節)
- フロントエンドはフレームワーク不使用、ビルドステップなし (spec: アーキテクチャ)
- ウォッチリストは `localStorage` にのみ保存し、サーバー側DBは持たない (spec: 画面構成)
- 自動ポーリングは行わない。更新は手動更新ボタンとページロード時のみ (spec: データ更新)
- レスポンシブCSSで、スマホ幅(〜480px)ではカード1列、それ以上は複数列にする (spec: 画面構成)
- 個別銘柄のAPI取得失敗はカード単位でエラー表示し、他の銘柄の表示は継続する (spec: エラーハンドリング)
- Workerのテストは quote/chart/search のレスポンス整形ロジックの単体テストのみ。フロントエンドの自動テストは設けない (spec: テスト方針)
- コミットメッセージは Conventional Commits(`feat:`, `fix:`, `docs:` など)を使う

---

## ファイル構成

```
20260815/
├── index.html                  # ダッシュボード
├── glossary.html                # 用語集ページ
├── css/
│   └── style.css                # 共通スタイル(レスポンシブ)
├── js/
│   ├── config.js                 # Worker URL・デフォルトウォッチリスト定義
│   ├── watchlist.js              # localStorageによるウォッチリスト管理
│   ├── api.js                    # Worker呼び出しクライアント
│   ├── chart.js                  # SVGスパークライン描画
│   ├── tooltip.js                # 用語ツールチップ
│   ├── glossary-terms.js         # 用語データ(ダッシュボード/用語集で共有)
│   ├── glossary.js               # 用語集ページのレンダリング
│   └── dashboard.js              # ダッシュボードの統合ロジック
├── worker/
│   ├── wrangler.toml             # Cloudflare Workers設定
│   ├── package.json              # {"type": "module"}のみ、依存なし
│   ├── src/
│   │   ├── yahoo.js               # Yahoo Finance呼び出し+レスポンス正規化
│   │   └── index.js               # ルーティング・CORS・エンドポイント
│   └── test/
│       └── yahoo.test.js          # yahoo.jsの単体テスト
├── docs/
│   ├── deploy-cloudflare.md      # Cloudflareデプロイ手順書
│   └── superpowers/               # (既存)spec/plan
└── README.md                     # プロジェクト概要・ローカル起動方法
```

---

### Task 1: Worker — Yahoo Finance呼び出し・正規化ロジック

**Files:**
- Create: `worker/package.json`
- Create: `worker/src/yahoo.js`
- Test: `worker/test/yahoo.test.js`

**Interfaces:**
- Produces (Task 2が使う):
  - `fetchChart(symbol: string, range: string, interval: string): Promise<object>` — Yahoo Finance `v8/finance/chart` の生JSONを返す
  - `fetchSearch(query: string): Promise<object>` — Yahoo Finance `v1/finance/search` の生JSONを返す
  - `normalizeChart(raw: object): { symbol, currency, shortName, price, previousClose, change, changePercent, points: {date, close}[] }` — 不正/エラーレスポンスの場合は `Error` をthrow
  - `normalizeSearch(raw: object): { symbol, name, exchange, type }[]`

- [ ] **Step 1: `worker/package.json` を作成**

```json
{
  "name": "investment-dashboard-worker",
  "private": true,
  "type": "module"
}
```

- [ ] **Step 2: 失敗する単体テストを書く**

`worker/test/yahoo.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeChart, normalizeSearch } from "../src/yahoo.js";

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
```

- [ ] **Step 2b: テストが失敗することを確認**

Run: `node --test worker/test/yahoo.test.js`
Expected: FAIL(`../src/yahoo.js` が存在しないためモジュール解決エラー)

- [ ] **Step 3: `worker/src/yahoo.js` を実装**

```js
const YAHOO_CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/";
const YAHOO_SEARCH_BASE = "https://query1.finance.yahoo.com/v1/finance/search";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const KNOWN_QUOTE_TYPES = new Set(["EQUITY", "INDEX", "CURRENCY", "ETF"]);

export async function fetchChart(symbol, range, interval) {
  const url = `${YAHOO_CHART_BASE}${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  return res.json();
}

export async function fetchSearch(query) {
  const url = `${YAHOO_SEARCH_BASE}?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  return res.json();
}

export function normalizeChart(raw) {
  const result = raw?.chart?.result?.[0];
  if (!result) {
    const message = raw?.chart?.error?.description || "銘柄データが見つかりません";
    throw new Error(message);
  }

  const meta = result.meta || {};
  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];

  const points = timestamps
    .map((ts, i) => ({ date: toDateString(ts), close: closes[i] }))
    .filter((p) => typeof p.close === "number");

  const price = typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice : null;
  const previousClose =
    typeof meta.chartPreviousClose === "number"
      ? meta.chartPreviousClose
      : typeof meta.previousClose === "number"
        ? meta.previousClose
        : null;
  const change = price !== null && previousClose !== null ? price - previousClose : null;
  const changePercent = change !== null && previousClose ? (change / previousClose) * 100 : null;

  return {
    symbol: meta.symbol || null,
    currency: meta.currency || null,
    shortName: meta.shortName || meta.symbol || null,
    price,
    previousClose,
    change,
    changePercent,
    points,
  };
}

export function normalizeSearch(raw) {
  const quotes = raw?.quotes || [];
  return quotes
    .filter((q) => q.symbol && KNOWN_QUOTE_TYPES.has(q.quoteType))
    .map((q) => ({
      symbol: q.symbol,
      name: q.shortname || q.longname || q.symbol,
      exchange: q.exchange || "",
      type: q.quoteType || "",
    }));
}

function toDateString(unixSeconds) {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `node --test worker/test/yahoo.test.js`
Expected: PASS(5 tests)

- [ ] **Step 5: Commit**

```bash
git add worker/package.json worker/src/yahoo.js worker/test/yahoo.test.js
git commit -m "feat: add Yahoo Finance fetch and normalization logic for worker"
```

---

### Task 2: Worker — ルーティング・CORS・エンドポイント実装

**Files:**
- Create: `worker/src/index.js`
- Create: `worker/wrangler.toml`

**Interfaces:**
- Consumes: `fetchChart`, `fetchSearch`, `normalizeChart`, `normalizeSearch`(Task 1、`worker/src/yahoo.js`)
- Produces(フロントエンドが呼び出す3エンドポイント):
  - `GET /api/quote?symbols=A,B,C` → `{ quotes: [{ symbol, shortName, currency, price, previousClose, change, changePercent } | { symbol, error: true, message }] }`
  - `GET /api/chart?symbol=A&range=3mo&interval=1d` → `{ symbol, currency, points: {date, close}[] }` または `{ error: true, message }`(404)
  - `GET /api/search?q=toyota` → `{ results: { symbol, name, exchange, type }[] }`

- [ ] **Step 1: `worker/wrangler.toml` を作成**

```toml
name = "investment-dashboard-proxy"
main = "src/index.js"
compatibility_date = "2026-08-15"
```

- [ ] **Step 2: `worker/src/index.js` を実装**

```js
import { fetchChart, fetchSearch, normalizeChart, normalizeSearch } from "./yahoo.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === "/api/quote") {
      return handleQuote(url);
    }
    if (url.pathname === "/api/chart") {
      return handleChart(url);
    }
    if (url.pathname === "/api/search") {
      return handleSearch(url);
    }

    return jsonResponse({ error: true, message: "not found" }, 404);
  },
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

async function handleQuote(url) {
  const symbolsParam = url.searchParams.get("symbols") || "";
  const symbols = symbolsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (symbols.length === 0) {
    return jsonResponse({ error: true, message: "symbols is required" }, 400);
  }

  const quotes = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const raw = await fetchChart(symbol, "5d", "1d");
        const normalized = normalizeChart(raw);
        return {
          symbol: normalized.symbol,
          shortName: normalized.shortName,
          currency: normalized.currency,
          price: normalized.price,
          previousClose: normalized.previousClose,
          change: normalized.change,
          changePercent: normalized.changePercent,
        };
      } catch (err) {
        return { symbol, error: true, message: err.message };
      }
    })
  );

  return jsonResponse({ quotes });
}

async function handleChart(url) {
  const symbol = url.searchParams.get("symbol");
  const range = url.searchParams.get("range") || "3mo";
  const interval = url.searchParams.get("interval") || "1d";

  if (!symbol) {
    return jsonResponse({ error: true, message: "symbol is required" }, 400);
  }

  try {
    const raw = await fetchChart(symbol, range, interval);
    const normalized = normalizeChart(raw);
    return jsonResponse({
      symbol: normalized.symbol,
      currency: normalized.currency,
      points: normalized.points,
    });
  } catch (err) {
    return jsonResponse({ error: true, message: err.message }, 404);
  }
}

async function handleSearch(url) {
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) {
    return jsonResponse({ results: [] });
  }

  try {
    const raw = await fetchSearch(q);
    return jsonResponse({ results: normalizeSearch(raw) });
  } catch (err) {
    return jsonResponse({ error: true, message: err.message }, 502);
  }
}
```

- [ ] **Step 3: ローカルで起動確認**

Run(`worker/` ディレクトリで): `npx wrangler dev`

期待: `http://localhost:8787` でWorkerが起動する。この環境からインターネット経由でYahoo Financeへ到達できない場合、`/api/quote` 等の実データ取得は失敗しうるが、それはこのタスクの合否とは無関係(Task 1のロジック単体テストが正である限りOK)。手元のブラウザ・別端末からアクセスできる環境であれば以下で疎通確認する:

```bash
curl "http://localhost:8787/api/search?q=toyota"
```

期待: `{"results":[...]}` 形式のJSONが返る(ネットワーク到達可能な場合)。到達できない場合は本番デプロイ後(Task 9のデプロイ手順)にあらためて確認する。

- [ ] **Step 4: Commit**

```bash
git add worker/src/index.js worker/wrangler.toml
git commit -m "feat: add worker routing, CORS handling, and API endpoints"
```

---

### Task 3: フロントエンド — 用語集(用語データ・ページ)

**Files:**
- Create: `js/glossary-terms.js`
- Create: `js/glossary.js`
- Create: `glossary.html`
- Create: `css/style.css`(このタスクでは用語集に必要な最小限のスタイルのみ追加。Task 8で全体を拡充する)

**Interfaces:**
- Produces(Task 7のtooltip.js、Task 8のdashboard.jsが使う):
  - `GLOSSARY_TERMS: { id, category, term, short, description }[]`(`js/glossary-terms.js` からexport)

- [ ] **Step 1: `js/glossary-terms.js` を作成**

```js
export const GLOSSARY_TERMS = [
  {
    id: "index",
    category: "指数",
    term: "株価指数",
    short: "市場全体の値動きを示す指標。個別銘柄の平均や加重平均で算出される。",
    description:
      "株価指数は、複数の銘柄の株価を一定のルールでまとめて算出した数値で、市場全体や特定セクターの値動きを把握するために使われます。日経平均株価は日本を代表する225銘柄の株価平均、S&P500は米国の主要500銘柄の時価総額加重平均です。個別銘柄そのものではなく「市場の体温計」として見る指標です。",
  },
  {
    id: "previous-close",
    category: "共通指標",
    term: "前日比",
    short: "前営業日の終値と比べた変動額・変動率。プラスは上昇、マイナスは下落。",
    description:
      "前日比は、直近の価格が前営業日の終値からどれだけ変化したかを示します。金額(円やドルなどの絶対値)と、変動率(%)の2通りで表されることが多く、変動率は「変化額 ÷ 前日終値 × 100」で計算します。",
  },
  {
    id: "ticker",
    category: "共通指標",
    term: "ティッカーシンボル",
    short: "銘柄を識別するための短い記号。例: AAPL(Apple)、7203.T(トヨタ自動車)。",
    description:
      "ティッカーシンボルは、取引所で銘柄を一意に識別するための記号です。米国株はアルファベットのみ(例: AAPL, MSFT)、日本株は証券コードに市場を表すサフィックスを付けた形(例: 7203.T)で表記されるのが一般的です。指数や為替にも専用の記号が使われます(例: ^N225 は日経平均、JPY=X は米ドル/円)。",
  },
  {
    id: "per",
    category: "個別株",
    term: "PER(株価収益率)",
    short: "株価が1株あたり利益の何倍かを示す指標。株価の割安・割高感の目安。",
    description:
      "PER(Price Earnings Ratio)は、株価を1株あたり利益(EPS)で割った値で、その株が利益水準に対して割安か割高かを判断する目安として使われます。数値が低いほど利益に対して株価が割安、高いほど割高と見られる傾向がありますが、業種や成長性によって適正水準は異なります。",
  },
  {
    id: "volume",
    category: "個別株",
    term: "出来高",
    short: "一定期間内に売買が成立した株数。市場の注目度や流動性の目安。",
    description:
      "出来高は、ある期間中に実際に売買が成立した株数(または口数)を指します。出来高が多い銘柄は取引が活発で売買が成立しやすく(流動性が高い)、株価が急に大きく動いた際に出来高も急増する傾向があります。",
  },
  {
    id: "exchange-rate",
    category: "為替",
    term: "為替レート",
    short: "ある通貨を別の通貨に交換する際の交換比率。例: USD/JPYは1米ドルが何円か。",
    description:
      "為替レートは、ある通貨を別の通貨と交換する際の比率です。USD/JPY(米ドル/円)が150であれば、1米ドルを150円と交換できることを意味します。輸出入企業の業績や海外資産の評価額に影響するため、投資の動向を見るうえでも重要な指標です。",
  },
  {
    id: "watchlist",
    category: "共通指標",
    term: "ウォッチリスト",
    short: "値動きを継続的に確認したい銘柄・指標をまとめたお気に入りリスト。",
    description:
      "ウォッチリストは、自分が値動きを継続的に確認したい銘柄や指標をまとめておくためのリストです。このページでは、ウォッチリストはブラウザの localStorage に保存され、他の端末とは共有されません。",
  },
];
```

- [ ] **Step 2: `js/glossary.js` を作成**

```js
import { GLOSSARY_TERMS } from "./glossary-terms.js";

function groupByCategory(terms) {
  const groups = new Map();
  for (const term of terms) {
    if (!groups.has(term.category)) {
      groups.set(term.category, []);
    }
    groups.get(term.category).push(term);
  }
  return groups;
}

export function renderGlossary(container, terms) {
  const groups = groupByCategory(terms);
  container.innerHTML = "";

  for (const [category, items] of groups) {
    const section = document.createElement("section");
    section.className = "glossary-category";

    const heading = document.createElement("h2");
    heading.textContent = category;
    section.appendChild(heading);

    for (const item of items) {
      const entry = document.createElement("div");
      entry.className = "glossary-entry";
      entry.id = item.id;

      const term = document.createElement("h3");
      term.textContent = item.term;
      entry.appendChild(term);

      const description = document.createElement("p");
      description.textContent = item.description;
      entry.appendChild(description);

      section.appendChild(entry);
    }

    container.appendChild(section);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("glossary-list");
  renderGlossary(container, GLOSSARY_TERMS);
});
```

- [ ] **Step 3: `css/style.css` を作成(用語集用の最小スタイル)**

```css
:root {
  --color-bg: #f7f8fa;
  --color-surface: #ffffff;
  --color-text: #1a1a1a;
  --color-muted: #6b7280;
  --color-border: #e5e7eb;
  --color-positive: #1b7a3d;
  --color-negative: #c0342c;
  --color-accent: #2563eb;
  --radius: 10px;
  --spacing: 16px;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: "Hiragino Sans", "Yu Gothic", system-ui, sans-serif;
  background: var(--color-bg);
  color: var(--color-text);
  line-height: 1.6;
}

.site-header {
  padding: var(--spacing);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.site-header h1 {
  font-size: 1.25rem;
  margin: 0;
}

.site-header nav a {
  color: var(--color-accent);
  text-decoration: none;
  font-size: 0.9rem;
}

.glossary-list {
  padding: var(--spacing);
  max-width: 720px;
  margin: 0 auto;
}

.glossary-category h2 {
  border-bottom: 2px solid var(--color-border);
  padding-bottom: 4px;
  margin-top: 32px;
}

.glossary-entry {
  margin: 16px 0;
}

.glossary-entry h3 {
  margin-bottom: 4px;
}
```

- [ ] **Step 4: `glossary.html` を作成**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>用語集 | 投資動向ダッシュボード</title>
<link rel="stylesheet" href="css/style.css" />
</head>
<body>
<header class="site-header">
  <h1>用語集</h1>
  <nav>
    <a href="index.html">← ダッシュボードに戻る</a>
  </nav>
</header>
<main id="glossary-list" class="glossary-list"></main>
<script type="module" src="js/glossary.js"></script>
</body>
</html>
```

- [ ] **Step 5: ローカルサーバーで表示確認**

`type="module"` のスクリプトは `file://` では読み込めない(ブラウザのモジュールCORS制限)ため、簡易サーバーを立てて確認する。

Run:
```bash
npx serve .
```
ブラウザで `http://localhost:3000/glossary.html` を開く。

期待: カテゴリ見出し(指数・共通指標・個別株・為替)ごとに用語が表示され、各見出しに `id`(例: `#per`)が付与されている。

- [ ] **Step 6: Commit**

```bash
git add js/glossary-terms.js js/glossary.js css/style.css glossary.html
git commit -m "feat: add glossary page with term data"
```

---

### Task 4: フロントエンド — 設定・ウォッチリスト管理

**Files:**
- Create: `js/config.js`
- Create: `js/watchlist.js`

**Interfaces:**
- Consumes: なし
- Produces(Task 5〜8が使う):
  - `WORKER_BASE_URL: string`, `DEFAULT_WATCHLIST: {symbol, name}[]`(`js/config.js`)
  - `loadWatchlist(): {symbol, name}[]`
  - `saveWatchlist(list: {symbol, name}[]): void`
  - `addSymbol(list, item: {symbol, name}): {symbol, name}[]`(重複時は変更しない)
  - `removeSymbol(list, symbol: string): {symbol, name}[]`

- [ ] **Step 1: `js/config.js` を作成**

```js
export const WORKER_BASE_URL = "https://investment-dashboard-proxy.YOUR-SUBDOMAIN.workers.dev";

export const DEFAULT_WATCHLIST = [
  { symbol: "^N225", name: "日経平均株価" },
  { symbol: "^GSPC", name: "S&P500" },
  { symbol: "JPY=X", name: "米ドル/円" },
];

export const WATCHLIST_STORAGE_KEY = "investment-dashboard:watchlist";
```

`WORKER_BASE_URL` はTask 9のデプロイ後、実際のWorker URLに書き換える(プレースホルダーである旨をコメントで明記する)。

- [ ] **Step 2: `js/watchlist.js` を作成**

```js
import { DEFAULT_WATCHLIST, WATCHLIST_STORAGE_KEY } from "./config.js";

export function loadWatchlist() {
  const raw = localStorage.getItem(WATCHLIST_STORAGE_KEY);
  if (!raw) {
    return [...DEFAULT_WATCHLIST];
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // 壊れたデータは無視してデフォルトに戻す
  }
  return [...DEFAULT_WATCHLIST];
}

export function saveWatchlist(list) {
  localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(list));
}

export function addSymbol(list, item) {
  if (list.some((entry) => entry.symbol === item.symbol)) {
    return list;
  }
  return [...list, item];
}

export function removeSymbol(list, symbol) {
  return list.filter((entry) => entry.symbol !== symbol);
}
```

- [ ] **Step 3: `addSymbol` / `removeSymbol` の動作をNodeで確認**

`localStorage` に依存しない純粋関数の部分だけをその場で検証する(自動テストスイートは追加しない。spec方針: フロントエンドは自動テストを設けない)。

Run:
```bash
node --input-type=module -e "
import { addSymbol, removeSymbol } from './js/watchlist.js';
const list = [{ symbol: 'AAPL', name: 'Apple' }];
const added = addSymbol(list, { symbol: 'MSFT', name: 'Microsoft' });
console.assert(added.length === 2, 'addSymbol should append a new symbol');
const dup = addSymbol(added, { symbol: 'AAPL', name: 'Apple' });
console.assert(dup.length === 2, 'addSymbol should ignore duplicates');
const removed = removeSymbol(added, 'AAPL');
console.assert(removed.length === 1 && removed[0].symbol === 'MSFT', 'removeSymbol should remove the matching entry');
console.log('watchlist.js OK');
"
```

期待: `watchlist.js OK` が出力され、`console.assert` によるエラーが出ない。

- [ ] **Step 4: Commit**

```bash
git add js/config.js js/watchlist.js
git commit -m "feat: add watchlist state management backed by localStorage"
```

---

### Task 5: フロントエンド — APIクライアント

**Files:**
- Create: `js/api.js`

**Interfaces:**
- Consumes: `WORKER_BASE_URL`(Task 4、`js/config.js`)
- Produces(Task 8が使う):
  - `fetchQuotes(symbols: string[]): Promise<{ quotes: object[] }>`
  - `fetchChart(symbol: string, range?: string, interval?: string): Promise<{ symbol, currency, points }>`
  - `searchSymbols(query: string): Promise<{ results: object[] }>`

- [ ] **Step 1: `js/api.js` を作成**

```js
import { WORKER_BASE_URL } from "./config.js";

async function getJson(path) {
  const res = await fetch(`${WORKER_BASE_URL}${path}`);
  if (!res.ok) {
    throw new Error(`APIエラー: ${res.status}`);
  }
  return res.json();
}

export function fetchQuotes(symbols) {
  const query = encodeURIComponent(symbols.join(","));
  return getJson(`/api/quote?symbols=${query}`);
}

export function fetchChart(symbol, range = "3mo", interval = "1d") {
  const query = `symbol=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`;
  return getJson(`/api/chart?${query}`);
}

export function searchSymbols(query) {
  return getJson(`/api/search?q=${encodeURIComponent(query)}`);
}
```

- [ ] **Step 2: 構文チェック**

Run: `node --check js/api.js`
Expected: 何も出力されず終了コード0(構文エラーなし)。実際のAPI疎通確認はTask 8のダッシュボード統合時にブラウザで行う。

- [ ] **Step 3: Commit**

```bash
git add js/api.js
git commit -m "feat: add API client for the Cloudflare Workers proxy"
```

---

### Task 6: フロントエンド — SVGスパークラインチャート

**Files:**
- Create: `js/chart.js`

**Interfaces:**
- Consumes: なし(DOM APIのみ使用)
- Produces(Task 8が使う):
  - `pointsToPath(points: {date, close}[], width?: number, height?: number, padding?: number): string`(SVG `path` の `d` 属性値)
  - `renderSparkline(container: HTMLElement, points: {date, close}[], width?: number, height?: number): void`

- [ ] **Step 1: `js/chart.js` を作成**

```js
const SVG_NS = "http://www.w3.org/2000/svg";
const WIDTH = 240;
const HEIGHT = 60;
const PADDING = 4;

export function pointsToPath(points, width = WIDTH, height = HEIGHT, padding = PADDING) {
  if (!points || points.length === 0) return "";

  const closes = points.map((p) => p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;

  const stepX = (width - padding * 2) / Math.max(points.length - 1, 1);

  return points
    .map((point, index) => {
      const x = padding + index * stepX;
      const y = height - padding - ((point.close - min) / range) * (height - padding * 2);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export function renderSparkline(container, points, width = WIDTH, height = HEIGHT) {
  container.innerHTML = "";
  if (!points || points.length === 0) {
    return;
  }

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", String(height));
  svg.setAttribute("preserveAspectRatio", "none");

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", pointsToPath(points, width, height));

  const isUp = points.at(-1).close >= points[0].close;
  path.setAttribute("stroke", isUp ? "var(--color-positive)" : "var(--color-negative)");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke-width", "2");

  svg.appendChild(path);
  container.appendChild(svg);
}
```

- [ ] **Step 2: `pointsToPath` の動作をNodeで確認**

`pointsToPath` はDOMに依存しない純粋関数なので、その場でNodeから直接検証する。

Run:
```bash
node --input-type=module -e "
import { pointsToPath } from './js/chart.js';
const path = pointsToPath([{ close: 10 }, { close: 20 }, { close: 15 }], 100, 50, 4);
console.assert(path.startsWith('M4.00,'), 'path should start with M at x=padding');
console.assert(path.split(' ').length === 3, 'path should have one command per point');
console.assert(pointsToPath([]) === '', 'empty points should produce an empty path');
console.log('chart.js OK');
"
```

期待: `chart.js OK` が出力され、`console.assert` によるエラーが出ない。

- [ ] **Step 3: Commit**

```bash
git add js/chart.js
git commit -m "feat: add SVG sparkline chart rendering"
```

---

### Task 7: フロントエンド — 用語ツールチップ

**Files:**
- Create: `js/tooltip.js`

**Interfaces:**
- Consumes: `GLOSSARY_TERMS`(Task 3、`js/glossary-terms.js`)
- Produces(Task 8が使う):
  - `initTooltips(root: HTMLElement): void` — `root` 配下の `.tooltip-icon[data-term]` にクリックでポップオーバーを開閉するハンドラを付与する

- [ ] **Step 1: `js/tooltip.js` を作成**

```js
import { GLOSSARY_TERMS } from "./glossary-terms.js";

const TERMS_BY_ID = new Map(GLOSSARY_TERMS.map((term) => [term.id, term]));

let activePopover = null;

function closePopover() {
  if (activePopover) {
    activePopover.remove();
    activePopover = null;
  }
}

function openPopover(button, term) {
  closePopover();

  const popover = document.createElement("div");
  popover.className = "tooltip-popover";
  popover.innerHTML = `
    <div>${term.short}</div>
    <a href="glossary.html#${term.id}">用語集で詳しく見る →</a>
  `;

  button.parentElement.appendChild(popover);
  popover.style.top = `${button.offsetTop + button.offsetHeight + 4}px`;
  popover.style.left = `${button.offsetLeft}px`;

  activePopover = popover;
}

export function initTooltips(root) {
  root.querySelectorAll(".tooltip-icon").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const term = TERMS_BY_ID.get(button.dataset.term);
      if (!term) return;
      if (activePopover && activePopover.parentElement === button.parentElement) {
        closePopover();
        return;
      }
      openPopover(button, term);
    });
  });
}

document.addEventListener("click", closePopover);
```

- [ ] **Step 2: 構文チェック**

Run: `node --check js/tooltip.js`
Expected: 何も出力されず終了コード0。DOM操作の実際の見た目確認はTask 8でブラウザから行う。

- [ ] **Step 3: Commit**

```bash
git add js/tooltip.js
git commit -m "feat: add glossary tooltip popovers"
```

---

### Task 8: フロントエンド — ダッシュボード統合

**Files:**
- Create: `index.html`
- Modify: `css/style.css`(カード・検索・ツールチップ用のスタイルを追加)
- Create: `js/dashboard.js`

**Interfaces:**
- Consumes: `loadWatchlist`, `saveWatchlist`, `addSymbol`, `removeSymbol`(Task 4)、`fetchQuotes`, `fetchChart`, `searchSymbols`(Task 5)、`renderSparkline`(Task 6)、`initTooltips`(Task 7)
- Produces: なし(最終統合レイヤー)

- [ ] **Step 1: `css/style.css` にダッシュボード用のスタイルを追記**

`css/style.css` の末尾に以下を追加する(Task 3で作成した内容の後ろに追記):

```css
main {
  padding: var(--spacing);
  max-width: 960px;
  margin: 0 auto;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: var(--spacing);
}

.toolbar input[type="text"] {
  flex: 1;
  min-width: 160px;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  font-size: 1rem;
}

.toolbar button {
  padding: 8px 14px;
  border: 1px solid var(--color-accent);
  background: var(--color-accent);
  color: #fff;
  border-radius: var(--radius);
  font-size: 0.9rem;
  cursor: pointer;
}

.search-results {
  list-style: none;
  margin: 0 0 var(--spacing);
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--color-surface);
}

.search-results:empty {
  display: none;
}

.search-results li {
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  justify-content: space-between;
  gap: 8px;
  cursor: pointer;
}

.search-results li:last-child {
  border-bottom: none;
}

.search-results li:hover {
  background: var(--color-bg);
}

.watchlist-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--spacing);
}

@media (min-width: 640px) {
  .watchlist-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (min-width: 960px) {
  .watchlist-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: var(--spacing);
  position: relative;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}

.card-title {
  font-weight: 600;
  font-size: 1rem;
}

.card-symbol {
  color: var(--color-muted);
  font-size: 0.8rem;
}

.card-remove {
  border: none;
  background: none;
  color: var(--color-muted);
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
}

.card-price {
  font-size: 1.5rem;
  font-weight: 700;
  margin-top: 8px;
}

.card-change {
  font-size: 0.9rem;
  margin-top: 4px;
}

.card-change.positive {
  color: var(--color-positive);
}

.card-change.negative {
  color: var(--color-negative);
}

.card-chart {
  margin-top: 12px;
}

.card-error {
  color: var(--color-negative);
  font-size: 0.9rem;
  margin-top: 8px;
}

.card-error button {
  margin-left: 8px;
}

.tooltip-icon {
  border: 1px solid var(--color-muted);
  border-radius: 50%;
  width: 16px;
  height: 16px;
  font-size: 0.7rem;
  line-height: 14px;
  text-align: center;
  color: var(--color-muted);
  background: none;
  cursor: pointer;
  padding: 0;
  margin-left: 4px;
}

.tooltip-popover {
  position: absolute;
  z-index: 10;
  max-width: 240px;
  background: var(--color-text);
  color: #fff;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 0.8rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.tooltip-popover a {
  color: #93c5fd;
}

.page-banner {
  background: #fdecea;
  border: 1px solid var(--color-negative);
  color: var(--color-negative);
  border-radius: var(--radius);
  padding: 10px 14px;
  margin-bottom: var(--spacing);
  font-size: 0.9rem;
}

.page-banner[hidden] {
  display: none;
}
```

- [ ] **Step 2: `index.html` を作成**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>投資動向ダッシュボード</title>
<link rel="stylesheet" href="css/style.css" />
</head>
<body>
<header class="site-header">
  <h1>投資動向ダッシュボード</h1>
  <nav>
    <a href="glossary.html">用語集</a>
  </nav>
</header>
<main>
  <div id="page-banner" class="page-banner" hidden>
    データを取得できませんでした。ネットワーク状況を確認し、更新ボタンで再試行してください。
  </div>
  <div class="toolbar">
    <input type="text" id="search-input" placeholder="銘柄を検索(例: トヨタ、AAPL)" />
    <button id="search-button" type="button">検索</button>
    <button id="refresh-button" type="button">更新</button>
  </div>
  <ul id="search-results" class="search-results"></ul>
  <div id="watchlist-grid" class="watchlist-grid"></div>
</main>
<script type="module" src="js/dashboard.js"></script>
</body>
</html>
```

- [ ] **Step 3: `js/dashboard.js` を作成**

```js
import { loadWatchlist, saveWatchlist, addSymbol, removeSymbol } from "./watchlist.js";
import { fetchQuotes, fetchChart, searchSymbols } from "./api.js";
import { renderSparkline } from "./chart.js";
import { initTooltips } from "./tooltip.js";

let watchlist = loadWatchlist();

const gridEl = document.getElementById("watchlist-grid");
const searchInputEl = document.getElementById("search-input");
const searchButtonEl = document.getElementById("search-button");
const searchResultsEl = document.getElementById("search-results");
const refreshButtonEl = document.getElementById("refresh-button");
const pageBannerEl = document.getElementById("page-banner");

function cardId(symbol) {
  return `card-${symbol.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }
  return value.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
}

function renderGrid() {
  gridEl.innerHTML = "";
  for (const item of watchlist) {
    const card = document.createElement("article");
    card.className = "card";
    card.id = cardId(item.symbol);
    card.innerHTML = `
      <div class="card-header">
        <div>
          <div class="card-title">${item.name}</div>
          <div class="card-symbol">${item.symbol}</div>
        </div>
        <button class="card-remove" data-symbol="${item.symbol}" aria-label="削除">×</button>
      </div>
      <div class="card-body">読み込み中...</div>
    `;
    gridEl.appendChild(card);
  }

  gridEl.querySelectorAll(".card-remove").forEach((button) => {
    button.addEventListener("click", () => {
      watchlist = removeSymbol(watchlist, button.dataset.symbol);
      saveWatchlist(watchlist);
      renderGrid();
      loadData();
    });
  });
}

function renderCardBody(symbol, quote, points) {
  const card = document.getElementById(cardId(symbol));
  if (!card) return;
  const body = card.querySelector(".card-body");

  if (!quote || quote.error) {
    body.innerHTML = `
      <div class="card-error">
        取得できませんでした
        <button class="retry-button" data-symbol="${symbol}">再試行</button>
      </div>
    `;
    body.querySelector(".retry-button").addEventListener("click", () => {
      loadData();
    });
    return;
  }

  const changeValue = quote.change ?? 0;
  const changeClass = changeValue >= 0 ? "positive" : "negative";
  const changeSign = changeValue >= 0 ? "+" : "";

  body.innerHTML = `
    <div class="card-price">
      ${formatNumber(quote.price)}
      <button class="tooltip-icon" data-term="previous-close" aria-label="前日比とは">?</button>
    </div>
    <div class="card-change ${changeClass}">
      ${changeSign}${formatNumber(quote.change)} (${changeSign}${formatNumber(quote.changePercent)}%)
    </div>
    <div class="card-chart"></div>
  `;

  const chartContainer = body.querySelector(".card-chart");
  if (points && points.length > 0) {
    renderSparkline(chartContainer, points);
  }

  initTooltips(body);
}

async function refreshCard(item) {
  try {
    const [quotesResponse, chart] = await Promise.all([
      fetchQuotes([item.symbol]),
      fetchChart(item.symbol, "3mo", "1d"),
    ]);
    const quote = quotesResponse.quotes[0];
    renderCardBody(item.symbol, quote, chart.points);
    return !quote.error;
  } catch (err) {
    renderCardBody(item.symbol, { symbol: item.symbol, error: true, message: err.message }, []);
    return false;
  }
}

async function loadData() {
  if (watchlist.length === 0) {
    pageBannerEl.hidden = true;
    return;
  }

  const results = await Promise.all(watchlist.map((item) => refreshCard(item)));
  const allFailed = results.every((ok) => !ok);
  pageBannerEl.hidden = !allFailed;
}

async function handleSearch() {
  const query = searchInputEl.value.trim();
  searchResultsEl.innerHTML = "";
  if (!query) return;

  let results;
  try {
    const response = await searchSymbols(query);
    results = response.results;
  } catch {
    searchResultsEl.innerHTML = "<li>検索に失敗しました</li>";
    return;
  }

  if (results.length === 0) {
    searchResultsEl.innerHTML = "<li>該当する銘柄が見つかりませんでした</li>";
    return;
  }

  for (const result of results) {
    const li = document.createElement("li");
    li.innerHTML = `<span>${result.name} (${result.symbol})</span><span>${result.exchange}</span>`;
    li.addEventListener("click", () => {
      watchlist = addSymbol(watchlist, { symbol: result.symbol, name: result.name });
      saveWatchlist(watchlist);
      searchResultsEl.innerHTML = "";
      searchInputEl.value = "";
      renderGrid();
      loadData();
    });
    searchResultsEl.appendChild(li);
  }
}

searchButtonEl.addEventListener("click", handleSearch);
searchInputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") handleSearch();
});
refreshButtonEl.addEventListener("click", loadData);

renderGrid();
loadData();
```

- [ ] **Step 4: ブラウザで手動確認**

Run:
```bash
npx serve .
```

`http://localhost:3000/index.html` を開き、以下を確認する:
- デフォルトのウォッチリスト(日経平均・S&P500・米ドル/円)がカード表示される(APIに到達できる環境の場合、価格・前日比・スパークラインが表示される。到達できない場合は各カードに「取得できませんでした」+再試行ボタンが表示されることを確認する)
- 検索欄にティッカーやキーワードを入力して検索し、結果からクリックしてウォッチリストに追加できる
- カードの×ボタンで削除でき、ページ再読み込み後も `localStorage` の内容が保持される
- `?` アイコンをクリックしてツールチップが開閉し、リンクから `glossary.html` の該当箇所に遷移する
- ブラウザの開発者ツールでモバイル幅(375px程度)に切り替え、カードが1列になり操作しやすいことを確認する
- 「更新」ボタンでウォッチリスト全体が再取得されることを確認する
- `js/config.js` の `WORKER_BASE_URL` を一時的に存在しないURLに書き換えて再読み込みし、全カードが失敗した際にページ上部の警告バナー(`#page-banner`)が表示されることを確認する。確認後は元のURLに戻す

この手動確認の結果(成功・失敗の詳細)を、次のステップに進む前に報告する。

- [ ] **Step 5: Commit**

```bash
git add index.html css/style.css js/dashboard.js
git commit -m "feat: integrate dashboard UI with watchlist, search, and tooltips"
```

---

### Task 9: ドキュメント — README更新・Cloudflareデプロイ手順書

**Files:**
- Modify: `README.md`
- Create: `docs/deploy-cloudflare.md`

**Interfaces:**
- Consumes: なし
- Produces: なし(ドキュメントのみ)

- [ ] **Step 1: `README.md` を更新**

```markdown
# 20260815 — 投資動向ダッシュボード

株価指数(日経平均・S&P500など)・個別株・為替の動向を確認できるウェブページ。用語解説つきで、スマホでも見やすいレイアウト。

## 構成

- フロントエンド: ビルド不要のVanilla HTML/CSS/JS(`index.html`, `glossary.html`, `css/`, `js/`)。GitHub Pagesで配信する。
- プロキシ: Cloudflare Workers(`worker/`)。Yahoo Finance非公式APIへのCORS中継を行う。

## ローカルで動かす

```bash
npx serve .
```

`http://localhost:3000/index.html` を開く。`type="module"` を使っているため `file://` では動作しない。

価格データを取得するには、事前に `worker/` をCloudflare Workersにデプロイし、`js/config.js` の `WORKER_BASE_URL` をデプロイ後のURLに書き換える必要がある。手順は [docs/deploy-cloudflare.md](docs/deploy-cloudflare.md) を参照。

## Workerのテスト

```bash
node --test worker/test/yahoo.test.js
```

## ドキュメント

- 設計: [docs/superpowers/specs/2026-08-15-investment-dashboard-design.md](docs/superpowers/specs/2026-08-15-investment-dashboard-design.md)
- 実装計画: [docs/superpowers/plans/2026-08-15-investment-dashboard.md](docs/superpowers/plans/2026-08-15-investment-dashboard.md)
- Cloudflareデプロイ手順: [docs/deploy-cloudflare.md](docs/deploy-cloudflare.md)
```

- [ ] **Step 2: `docs/deploy-cloudflare.md` を作成**

```markdown
# Cloudflare Workers デプロイ手順

このプロジェクトの `worker/` を Cloudflare Workers にデプロイし、フロントエンドから使えるようにするための手順。

## 前提

- Node.js がインストールされていること(`node -v` で確認)
- Cloudflareアカウントを持っていない場合は事前に作成する: https://dash.cloudflare.com/sign-up

## 手順

1. `worker/` ディレクトリに移動する

   ```bash
   cd worker
   ```

2. Cloudflareにログインする(ブラウザが開き、Cloudflareアカウントでの認可を求められる)

   ```bash
   npx wrangler login
   ```

   `npx` により `wrangler` はその場でダウンロードされるだけで、`package.json` には追加されない。

3. デプロイする

   ```bash
   npx wrangler deploy
   ```

   成功すると、`https://investment-dashboard-proxy.<あなたのサブドメイン>.workers.dev` のようなURLが表示される。このURLを控えておく。

4. フロントエンドの設定を更新する

   `js/config.js` の `WORKER_BASE_URL` を、手順3で控えたURLに書き換える。

   ```js
   export const WORKER_BASE_URL = "https://investment-dashboard-proxy.<あなたのサブドメイン>.workers.dev";
   ```

5. 変更をコミットし、GitHub Pagesへ反映する(GitHub PagesはリポジトリのSettings → Pages → Source を `main` ブランチ / `/(root)` に設定しておく)

6. 動作確認

   GitHub Pagesで公開されたURL(例: `https://emperorpenguinA.github.io/20260815/`)を開き、ウォッチリストのカードに価格・前日比・チャートが表示されることを確認する。表示されない場合は、ブラウザの開発者ツール(Console/Network)で `/api/quote` 等へのリクエストがCORSエラーや404になっていないか確認する。

## 注意事項

- Yahoo Financeの非公式APIを利用しているため、Yahoo側の仕様変更やレート制限によって取得できなくなる可能性がある。その場合はWorker側のエンドポイント(`worker/src/yahoo.js`)を更新する必要がある。
- Cloudflare Workersの無料枠は1日10万リクエストまで。個人利用の範囲では通常問題にならない。
- Workerを再デプロイした場合もURLは変わらないため、`WORKER_BASE_URL` の再設定は不要。
```

- [ ] **Step 3: Commit**

```bash
git add README.md docs/deploy-cloudflare.md
git commit -m "docs: add README overview and Cloudflare deployment guide"
```
