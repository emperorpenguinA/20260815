# PPP機能: 追加4通貨(NZD・TRY・MXN・ZAR) 設計仕様書

## 背景

既存のPPP(購買力平価)機能は、対米ドル6通貨(JPY・EUR・GBP・CNY・AUD・CAD)・対日本円5通貨(EUR・GBP・CNY・AUD・CAD)を比較している(PR #10・#11でマージ済み)。ユーザーからNZD(ニュージーランドドル)・TRY(トルコリラ)・MXN(メキシコペソ)・ZAR(南アフリカランド)の追加要望があり、実現可能性を確認済み。

## 目的

上記4通貨を、対米ドル・対日本円の両方の比較対象に追加する。新しいアーキテクチャ・関数は不要で、既存の設定配列(`PPP_CURRENCIES`・`PPP_JPY_CROSS_CURRENCIES`)にエントリを追加するだけで実現できる。

## データ確認結果

### World Bank PPPデータ

`PA.NUS.PPP`指標で、NZL・TUR・MEX・ZAFいずれも2020〜2025年の6年分のデータが存在することを実データで確認済み(既存6通貨は2010年〜の16年分)。

**既知の制約**: 期間選択で「10年」を選んだ場合、2020年より前の月はPPPデータが存在しないため、既存の`forwardFillPpp`の仕様通りその月のPPP値は`null`になり、`points`配列から除外される(既存のnullフィルタ処理がそのまま機能する。新たな考慮は不要)。

### Yahoo Financeシンボル

対米ドル・対日本円それぞれ、実データで以下を確認済み:

| 通貨 | 対米ドルシンボル | 値の意味 | invert | 対日本円シンボル | 値の意味 |
|---|---|---|---|---|---|
| NZD | `NZDUSD=X` | 1NZD=何ドル | true(逆数変換が必要) | `NZDJPY=X` | 1NZD=何円 |
| TRY | `TRY=X` | 1ドル=何リラ | false | `TRYJPY=X` | 1リラ=何円 |
| MXN | `MXN=X` | 1ドル=何ペソ | false | `MXNJPY=X` | 1ペソ=何円 |
| ZAR | `ZAR=X` | 1ドル=何ランド | false | `ZARJPY=X` | 1ランド=何円 |

対日本円のシンボルはいずれも「1外貨=何円」の直接クオートで、逆数変換は不要(既存のEUR/GBP/CNY/AUD/CADと同じパターン)。

### トルコリラの変動幅について

トルコリラは近年の急激な為替下落により、割安/割高%が既存通貨より大きな数値になる(実データ例: 対米ドルで実勢47.86に対しPPP16.20、%にして195%超)。これは実装上の不具合ではなく実態を反映した値であり、`formatNumber`・表示ロジックとも既存のまま数値の大小に関わらず正しく扱える。特別な上限処理などは設けない。

## 実装内容

### `worker/src/ppp.js`の変更

- `PPP_CURRENCIES`(対米ドル)に4エントリを追加:

  ```js
  { currency: "NZD", iso3: "NZL", yahooSymbol: "NZDUSD=X", pair: "USD/NZD", invert: true, note: null },
  { currency: "TRY", iso3: "TUR", yahooSymbol: "TRY=X", pair: "USD/TRY", invert: false, note: null },
  { currency: "MXN", iso3: "MEX", yahooSymbol: "MXN=X", pair: "USD/MXN", invert: false, note: null },
  { currency: "ZAR", iso3: "ZAF", yahooSymbol: "ZAR=X", pair: "USD/ZAR", invert: false, note: null },
  ```

- `PPP_JPY_CROSS_CURRENCIES`(対日本円)に4エントリを追加:

  ```js
  { currency: "NZD", iso3: "NZL", yahooSymbol: "NZDJPY=X", pair: "NZD/JPY", note: null },
  { currency: "TRY", iso3: "TUR", yahooSymbol: "TRYJPY=X", pair: "TRY/JPY", note: null },
  { currency: "MXN", iso3: "MEX", yahooSymbol: "MXNJPY=X", pair: "MXN/JPY", note: null },
  { currency: "ZAR", iso3: "ZAF", yahooSymbol: "ZARJPY=X", pair: "ZAR/JPY", note: null },
  ```

### `worker/src/index.js`

変更不要。`handlePpp`のWorld Bank取得対象国リストは、既に`PPP_CURRENCIES`と`PPP_JPY_CROSS_CURRENCIES`両方のiso3コードの和集合を動的に組み立てる実装になっている(PR #11の最終レビュー修正で導入済み)ため、上記の配列追加だけで自動的に新4通貨分もWorld Bankへのリクエストに含まれる。

### フロントエンド(`js/ppp.js`・`index.html`・`css/style.css`)

変更不要。カードのレンダリングは`/api/ppp`のレスポンス配列(`indicators`・`crossIndicators`)をそのままループして描画する実装になっており、要素数が10・9に増えても既存のロジック・グリッドレイアウトがそのまま機能する。

## テスト方針

- `worker/test/ppp.test.js`: `PPP_CURRENCIES`・`PPP_JPY_CROSS_CURRENCIES`が新しい通貨数(10・9)を含むこと、新4通貨のフィールド値(iso3・yahooSymbol・pair・invert)が正しいことを検証するテストを追加・更新
- `worker/test/index.test.js`: 既存の`/api/ppp`集約テストのフィクスチャに新4通貨分のWorld Bank・Yahooデータを追加し、`indicators`・`crossIndicators`の件数が10・9になることを検証
- フロントエンドは`node --check`で構文確認し、ブラウザで新4通貨分のカードが対米ドル・対日本円の両セクションに表示されることを目視確認する

## スコープ外(今回やらないこと)

- NZD・TRY・MXN・ZAR以外の通貨追加
- World Bankデータが2020年より前の期間に遡れないことへの対応(既存のnullフィルタ処理で十分と判断)
- トルコリラの大きな%表示に対する特別な警告・注記UI
