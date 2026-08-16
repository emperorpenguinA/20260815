# 購買力平価(PPP)機能 設計仕様書

## 背景

PR #8で日米のCPI・PPIを追加した際、購買力平価(PPP)はデータソース・更新頻度(年次)が異なるため、スコープ外として別途後日検討することにしていた(`docs/superpowers/specs/2026-08-16-economic-indicators-design.md`参照)。今回、そのPPPを検討・実装する。

## 目的

主要通貨について、**実勢為替レート**と**PPPで計算した理論上の適正レート**を比較し、割高・割安を可視化する。投資判断の一材料として使えることを重視する(生活費比較やGDP比較は対象外)。

## 対象通貨

対米ドルで、JPY・EUR・GBP・CNY・AUD・CADの6通貨。

**制約**: World Bank APIのユーロ圏集計値(`EMU`)はPPP指標(`PA.NUS.PPP`)を提供していない(`null`が返ることを実データで確認済み)。そのため、EURはドイツ(`DEU`)のPPP値を代表値として使う。カードには「ユーロ圏の代表値としてドイツの数値を使用」という注記を表示する。

## データソース

### PPP理論レート: World Bank API

- エンドポイント: `https://api.worldbank.org/v2/country/{ISO3コード;...}/indicator/PA.NUS.PPP?format=json&date={範囲}`
- 認証不要。6カ国分を1回のリクエストでまとめて取得できることを実データで確認済み(`JPN;GBR;CHN;AUS;CAN;DEU`)
- 指標`PA.NUS.PPP`は「PPP conversion factor, GDP (LCU per international $)」= 1国際ドルあたりの現地通貨額
- 2010年〜2025年まで、対象6カ国すべてで欠損なくデータが存在することを確認済み
- 各国、直近の非null年の値を「最新のPPPレート」として採用する

### 実勢為替レート: 既存のYahoo Finance連携(`fetchChart`)を流用

Yahoo FinanceのFXシンボルには向きの違いがあるため、通貨ごとに変換方法を分ける。実データで確認済み:

| 通貨 | Yahooシンボル | 値の意味 | 変換 |
|---|---|---|---|
| JPY | `JPY=X` | 1ドル=何円 | そのまま使用 |
| CNY | `CNY=X` | 1ドル=何元 | そのまま使用 |
| CAD | `CAD=X` | 1ドル=何カナダドル | そのまま使用 |
| EUR | `EURUSD=X` | 1ユーロ=何ドル | 逆数(`1 / rate`) |
| GBP | `GBPUSD=X` | 1ポンド=何ドル | 逆数(`1 / rate`) |
| AUD | `AUDUSD=X` | 1豪ドル=何ドル | 逆数(`1 / rate`) |

World Bank側のPPP値が「1国際ドルあたりの現地通貨」なので、実勢レートも同じ向き(現地通貨/USD)に揃えてから比較する。

## バックエンド設計

### `worker/src/ppp.js`(新規)

- `PPP_CURRENCIES`: 対象6通貨の設定(通貨コード、ISO3コード、Yahooシンボル、逆数変換が必要か、表示ペア名、注記の有無)
- `fetchWorldBankPpp(iso3Codes)`: World Bank APIへ1回のリクエストでまとめて取得
- `normalizeWorldBankPpp(raw, iso3Code)`: 指定国の、直近の非null年のPPP値と年を返す
- `forwardFillPpp(monthDates, pppByYear)`: 月次の日付配列それぞれに対し、その月が属する年のPPP値があればそれを使い、なければ「その年より前で最新の、値がある年」のPPP値を使う(例: 2026年分がまだ未公開なら2025年の値を使う「階段状」のフォワードフィル)
- `computeOverUndervaluedPercent(actualRate, pppRate)`: `((actualRate - pppRate) / pppRate) * 100`。正の値は「実勢レートがPPPより現地通貨建てで多く必要」= 現地通貨が理論値より割安、と解釈する

### `worker/src/index.js`の変更

- `parseEconMonths`を`parseMonthsParam(url, defaultMonths)`に一般化し、`/api/econ`・`/api/ppp`の両方で共有する(クランプ範囲は既存通り6〜600)
- 新規`handlePpp(months)`。通貨ごとに以下の順で処理し、独立してtry/catchする(1通貨の失敗が他に影響しないようにする、既存の8指標と同じエラー分離方針):
  1. 実勢レートを既存の`fetchChart(symbol, "10y", "1mo")`で常に10年分月次取得し、`takeRecentMonths(points, months)`で選択期間に切り詰める(既存のCPI/PPIと同じ手法)
  2. 切り詰め後の月次日付配列に対して`forwardFillPpp`でPPP値を割り当て、`{date, actual, ppp}`の`points`配列を組み立てる
  - World Bank APIへのリクエスト自体は、6カ国分を1回のリクエストでまとめて取得し、通貨ごとのループの外で1回だけ行う(6回の重複リクエストを避ける)
- 新規ルート`/api/ppp`

### レスポンス形式

```json
{
  "indicators": [
    {
      "currency": "JPY",
      "pair": "USD/JPY",
      "points": [{ "date": "2016-08", "actual": 102.3, "ppp": 97.6 }, ...],
      "latestActual": 159.31,
      "latestPpp": 97.08,
      "pppYear": 2025,
      "overUndervaluedPercent": 64.1,
      "note": null
    },
    {
      "currency": "EUR",
      "pair": "EUR/USD",
      "points": [...],
      "latestActual": 0.864,
      "latestPpp": 0.71,
      "pppYear": 2025,
      "overUndervaluedPercent": 21.7,
      "note": "ユーロ圏の代表値としてドイツの数値を使用"
    }
  ]
}
```

エラー時は`{ "currency": "...", "pair": "...", "error": true, "message": "..." }`。

## フロントエンド設計

### `js/chart.js`の変更

既存の`renderSparkline`(単一系列)とは別に、新規`renderComparisonChart(container, points, options)`を追加する。

- `points`は`{ date, actual, ppp }`の配列
- 実勢レートを実線、PPPレートを破線で重ね描き。Y軸スケールは両系列の合算min/maxで揃え、乖離が視覚的にわかるようにする
- ホバー・タップで最寄り点の両方の値をツールチップ表示(例: `2024-06: 実勢153.2 / PPP94.1`)
- 既存の`renderSparkline`のロジック(座標変換・ツールチップ表示・ポインタイベント)は流用できる部分を共通化し、パスの描画と色分けだけを新関数側で扱う

### `js/ppp.js`(新規)

- `econ.js`と同様の構成: `/api/ppp`を叩いてカードをレンダリング
- 専用の期間選択(1年/3年/5年/10年、`econ-period-selector`と同じUIパターン)を持つ。CPI/PPI用の期間選択とは独立
- カード内容: ヘッダー(通貨ペア名)→ 比較チャート → キャプション(実勢・PPP・年・割安/割高%) → (EURのみ)注記
- 割安/割高の文言は`overUndervaluedPercent`の符号から動的生成する(例: 「円は理論値より64.1%割安」)。色分けは既存の positive/negative クラスを流用

### `index.html` / `css/style.css`

- 「経済指標(CPI・PPI)」セクション内、既存の`econ-grid`の下に「購買力平価(PPP)」というh3見出しと、専用の期間選択(`ppp-period-selector`)・グリッド(`ppp-grid`)を追加
- `js/ppp.js`をモジュールスクリプトとして読み込み追加
- 比較チャートの凡例・注記用に、控えめなスタイル(`.card-note`など)を追加

### 用語集

`js/glossary-terms.js`に「購買力平価(PPP)」の項目を追加し、各PPPカードのツールチップアイコンから参照できるようにする。

## テスト方針

- `worker/test/ppp.test.js`(新規): `forwardFillPpp`・`computeOverUndervaluedPercent`・`normalizeWorldBankPpp`・逆数変換ロジックの単体テスト、`fetchWorldBankPpp`のリクエストURL検証
- `worker/test/index.test.js`: `/api/ppp`のルーティング・6通貨集約・エラー分離・`months`パラメータのテストを追加(既存の`/api/econ`テストと同じパターン)
- フロントエンドは`node --check`で構文確認し、ブラウザで実際にチャート描画・期間切り替え・ツールチップを目視確認する

## スコープ外(今回やらないこと)

- ユーロ圏以外の複数国比較や、対象通貨をユーザーが追加・変更できるUI(固定6通貨)
- キャッシュ機構の導入(既存の8指標と同じく、リクエストの都度取得。PPPは年次更新のため実害は小さい)
- 生活費比較・GDP比較など、為替レート比較以外のPPPの切り口
