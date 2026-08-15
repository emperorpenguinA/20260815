# 経済指標(CPI・PPI)セクション 設計書

- 日付: 2026-08-16
- ステータス: 承認済み

## 背景・目的

投資動向ダッシュボードのユーザーから「CPI(消費者物価指数)・PPI(企業物価指数/生産者物価指数)を、国内(輸出・輸入含む)と米国で比較して見たい」という要望があった。物価指標は株価・為替と並んでマクロ経済の動向を把握するうえで重要な指標であり、既存のウォッチリストに続けてダッシュボード上で確認できるようにする。

購買力平価(PPP)も当初の要望に含まれていたが、CPI・PPIとはデータソース・更新頻度(年次)が異なり設計が大きくなるため、今回のスコープからは除外し、別途後日検討する。

## スコープ

対象:
- 日本: 消費者物価指数(CPI)、国内企業物価指数(PPI相当)、輸出物価指数、輸入物価指数
- 米国: 消費者物価指数(CPI)、生産者物価指数(PPI)、輸出物価指数、輸入物価指数
- 各指標について、前年同月比(%)と指数の推移グラフを表示

対象外(今回は実装しない):
- 購買力平価(PPP) — 別途後日検討
- 日本・米国以外の国
- 月次以外の頻度でのデータ更新・リアルタイム性

## データソース

| 指標 | 国 | ソース | 認証 |
|---|---|---|---|
| CPI | 日本 | e-Stat API (`https://api.e-stat.go.jp/`) | 要`appId`(無料ユーザー登録) |
| 国内企業物価指数・輸出物価指数・輸入物価指数 | 日本 | 日本銀行 時系列統計データAPI (`https://www.stat-search.boj.or.jp/api/v1/`) | **不要**(誰でも利用可能) |
| CPI・PPI・輸出物価指数・輸入物価指数 | 米国 | FRED API (`https://api.stlouisfed.org/fred/`) | 要`api_key`(無料アカウント登録) |

### e-Stat API

- ユーザー登録後に発行される`appId`をクエリパラメータで渡す
- 消費者物価指数(総合・全国)の統計表から、月次の指数値の時系列を取得する

### 日本銀行 時系列統計データAPI

- 3種類のエンドポイントがある: `getDataCode`(コード指定)、`getDataLayer`(階層指定)、`getMetadata`(メタデータ取得)
- 認証不要。`format=json`でJSON形式のレスポンスを取得できる
- 国内企業物価指数・輸出物価指数・輸入物価指数それぞれの系列コードは、`getMetadata`で調べるか、日銀の時系列統計データ検索サイト(`https://www.stat-search.boj.or.jp/`)上で該当系列を検索して特定する(実装時に確定させる)
- 利用上の制限: 短時間の連続アクセス禁止、1リクエストあたり250系列/60,000件まで。このアプリの用途(数系列を都度取得)では問題にならない

### FRED API

- `https://api.stlouisfed.org/fred/series/observations?series_id=<ID>&api_key=<KEY>&file_type=json`の形式
- 米国CPIは`CPIAUCSL`など、PPI・輸出入物価指数も該当する`series_id`を実装時に確認して使用する
- 無料APIキーが必要(St. Louis連銀のサイトでユーザー登録)

## バックエンド設計

**新規ファイル: `worker/src/econ.js`**(既存の`worker/src/yahoo.js`と同じ役割分担。3ソースの取得・正規化ロジックをまとめる)

- `fetchJapanCpi(appId)`: e-Stat APIから日本のCPI(総合・全国、月次)の生データを取得する
- `fetchBojPriceIndex(seriesCode)`: 日銀APIから指定系列(国内企業物価指数・輸出物価指数・輸入物価指数のいずれか)の生データを取得する。3系列とも同じ関数を使い回す
- `fetchUsIndicator(seriesId, apiKey)`: FRED APIから指定系列(米国CPI・PPI・輸出物価指数・輸入物価指数のいずれか)の生データを取得する。4系列とも同じ関数を使い回す
- 各ソースに対応する`normalizeJapanCpi`・`normalizeBojPriceIndex`・`normalizeUsIndicator`関数で、生データを共通の形へ変換する:
  ```js
  { points: [{ date: "YYYY-MM", value: number }] }
  ```
- `computeYoyPercent(points)`: 月次の`points`配列から、最新値と12ヶ月前の値を使って前年同月比(%)を計算する共通のヘルパー関数(3ソースとも前年同月比を直接返すとは限らないため、自前で計算する)

**`worker/src/index.js`への追加**

- `GET /api/econ`エンドポイントを追加。8指標(日本4・米国4)それぞれを個別にtry/catchで取得し、`Promise.all`で並行実行する。1指標の取得失敗は他の指標に影響しない(既存の`/api/quote`の per-symbol エラー分離と同じ設計)
- `env`(Cloudflare Workersのシークレットバインディング)から`ESTAT_APP_ID`・`FRED_API_KEY`を読み取る。これに伴い、`fetch`ハンドラのシグネチャを`async fetch(request)`から`async fetch(request, env)`に変更し、`handleEcon(url, env)`のように必要な箇所へ`env`を渡す

**レスポンス形式**

```json
{
  "indicators": [
    {
      "id": "jp-cpi",
      "country": "JP",
      "label": "消費者物価指数(CPI)",
      "yoyPercent": 2.5,
      "latestDate": "2026-06",
      "points": [{ "date": "2025-07", "value": 108.2 }, ...]
    },
    { "id": "jp-ppi-domestic", "country": "JP", "label": "国内企業物価指数(PPI)", ... },
    { "id": "jp-ppi-export", "country": "JP", "label": "輸出物価指数", ... },
    { "id": "jp-ppi-import", "country": "JP", "label": "輸入物価指数", ... },
    { "id": "us-cpi", "country": "US", "label": "消費者物価指数(CPI)", ... },
    { "id": "us-ppi-domestic", "country": "US", "label": "生産者物価指数(PPI)", ... },
    { "id": "us-ppi-export", "country": "US", "label": "輸出物価指数", ... },
    { "id": "us-ppi-import", "country": "US", "label": "輸入物価指数", ... }
  ]
}
```

取得に失敗した指標は `{ "id": "...", "country": "...", "label": "...", "error": true, "message": "..." }` の形で返す。

**キャッシュ**: 月次更新のデータであり毎回取得し直す必然性は薄いが、既存の`/api/quote`等と同様まずはリクエストの都度取得するシンプルな実装とする。将来的にレスポンス速度や外部APIへの負荷が問題になれば、Cloudflare Cache APIによるキャッシュを追加で検討する(YAGNI)。

## フロントエンド設計

**`index.html`**: 既存のウォッチリストセクションの下に「経済指標」セクション(`<section id="econ-section">`)を追加する。日本・米国を比較しやすいよう、2列(JP/US)×4行(CPI・PPI・輸出物価指数・輸入物価指数)のグリッドでカードを並べる。スマホ幅では既存のウォッチリスト同様1列になるようレスポンシブ対応する。

**新規ファイル: `js/econ.js`**(`js/dashboard.js`と同様の構造)

- ページロード時に`/api/econ`を1回取得し、8枚のカードを描画する
- 各カードの表示内容:
  - ラベル(例:「消費者物価指数(CPI)」)+ 国名
  - 前年同月比(%)を大きく表示。上昇は緑、下落は赤(既存の`.card-change`と同じ配色ルールを流用)
  - 指数の推移グラフ(`js/chart.js`の`renderSparkline`をそのまま再利用。ホバー/タップでの日付・値表示もそのまま使える)
  - 取得失敗時はカード単位で「取得できませんでした」+再試行ボタン(既存パターンを踏襲)
- 手動更新ボタンは設けない(月次データのため、ページ再読み込みで十分)

**用語集(`js/glossary-terms.js`)への追加**: 以下5項目を追加する
- CPI(消費者物価指数)
- PPI(企業物価指数・生産者物価指数)
- 輸出物価指数
- 輸入物価指数
- 前年同月比

各カードのラベル横に既存の`?`ツールチップアイコンを付け、該当する用語集項目にリンクする。

## デプロイ手順への追加(`docs/deploy-cloudflare.md`)

以下の手順を追記する:
1. e-Stat(政府統計の総合窓口)でユーザー登録し、アプリケーションID(`appId`)を取得する手順
2. FRED(St. Louis連銀)でアカウント登録し、APIキーを取得する手順
3. `npx wrangler secret put ESTAT_APP_ID` / `npx wrangler secret put FRED_API_KEY` を実行してWorkerにシークレットとして登録する手順
4. 日本銀行APIは登録不要である旨の注記

## テスト方針

- `worker/test/econ.test.js`を新規作成し、既存の`worker/test/yahoo.test.js`と同じ方針で以下を単体テストする:
  - 各`normalize*`関数(生データ→共通形式への変換ロジック)
  - `computeYoyPercent`(前年同月比の計算ロジック、12ヶ月分のデータが揃っていない場合のエッジケースを含む)
  - `handleEcon`のエンドポイントレベルの挙動(`global.fetch`をモックし、1指標の失敗が他の指標に影響しないこと)
- フロントエンド(`js/econ.js`)は既存方針を踏襲し自動テストを設けず、ブラウザでの手動確認を中心とする

## エラーハンドリング

- 8指標それぞれ個別にエラーを分離する(1つのAPIソース全体が落ちても、他のソースの指標は表示され続ける)
- `ESTAT_APP_ID`・`FRED_API_KEY`が未設定(シークレット未登録)の場合、該当する指標はエラー表示になるが、日銀APIを使う指標(登録不要)は正常に表示される

## 未確定事項・今後の検討

- 日銀APIの系列コード(国内企業物価指数・輸出物価指数・輸入物価指数それぞれ)、およびFREDのPPI・輸出入物価指数の`series_id`は、実装時に各APIのメタデータ・ドキュメントで確認して確定させる
- 購買力平価(PPP)は今回のスコープ外。別途、データソース(OECD・世界銀行など)と更新頻度(年次)を踏まえて改めて設計する
- キャッシュ導入の要否は、実際の利用状況を見て判断する
