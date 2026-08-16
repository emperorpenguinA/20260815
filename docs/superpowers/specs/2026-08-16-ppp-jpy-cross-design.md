# PPP機能: 日本円基準の比較 追加 設計仕様書

## 背景

PR #10で購買力平価(PPP)機能をマージした後、ユーザーから「ドルとの比較だけでなく日本円と他の通貨の比較が必要」との指摘があった。現状の`/api/ppp`は6通貨(JPY・EUR・GBP・CNY・AUD・CAD)をすべて対米ドルで比較しているが、日本円を基準にした比較(EUR/JPY・GBP/JPY・CNY/JPY・AUD/JPY・CAD/JPY)を追加する。

## 目的

対米ドルの比較は残したまま、日本円を基準にした5通貨との比較を追加する。ユーザーの関心は「円が他通貨に対して割安か割高か」にあるため、割安/割高の文言は常に日本円を主語にする。

## 対象

対米ドル比較(既存、変更なし): JPY・EUR・GBP・CNY・AUD・CAD

対日本円比較(新規): EUR/JPY・GBP/JPY・CNY/JPY・AUD/JPY・CAD/JPY の5ペア(JPY自身との比較は対象外)

## データ取得・計算

### 実勢レート: Yahoo Financeの直接クロスシンボル

実データで確認済み、いずれも「1単位の外貨 = 何円」の向きでそのまま使える(対米ドル比較のEUR/GBP/AUDのような逆数変換は不要):

| 通貨 | Yahooシンボル | 値の意味 |
|---|---|---|
| EUR | `EURJPY=X` | 1ユーロ=何円 |
| GBP | `GBPJPY=X` | 1ポンド=何円 |
| AUD | `AUDJPY=X` | 1豪ドル=何円 |
| CAD | `CADJPY=X` | 1カナダドル=何円 |
| CNY | `CNYJPY=X` | 1元=何円 |

### PPP理論レート: 既存のWorld Bankデータから計算(新規API呼び出しなし)

`/api/ppp`は既に1回のリクエストで6通貨分のPPP変換係数(1国際ドルあたりの現地通貨額)をまとめて取得している。日本円基準の理論レートは、この既存データから割り算で導出する:

```
理論レート(対象通貨/JPY) = 日本円のPPP変換係数 ÷ 対象通貨のPPP変換係数
```

例: EUR/JPYの理論値 = 97.08(JPYのPPP係数) ÷ 0.70998(EURのPPP係数、ドイツ代表値) ≈ 136.7円

月次グリッドへのフォワードフィルは、既存の`forwardFillPpp`をそのまま再利用する。日本円と対象通貨、それぞれの年次PPPデータが両方揃っている年だけを対象に、年ごとの比率(`日本円PPP ÷ 対象通貨PPP`)をあらかじめ計算した`{年: 比率}`マップを作り、それを`forwardFillPpp`に渡す(新しいフォワードフィル関数は不要)。

**既知の制約**: 日本円と対象通貨で最新の公開年が異なる場合(現状はどちらも2025年で揃っているが、将来的にずれる可能性がある)、両方に共通する年だけを比率計算の対象とする。共通する年が1つもない場合はエラー扱いとする。

### ユーロの注記

対円のEUR/JPYカードも、対米ドルのEUR/USDカードと同じ「ユーロ圏の代表値としてドイツの数値を使用」という注記を表示する(引き続きドイツのPPP係数を使っているため)。

## レスポンス形式

`/api/ppp`のレスポンスに、既存の`indicators`配列とは別に`crossIndicators`配列を追加する:

```json
{
  "indicators": [ ... 既存の6通貨、変更なし ... ],
  "crossIndicators": [
    {
      "currency": "EUR",
      "pair": "EUR/JPY",
      "points": [{ "date": "2016-08", "actual": 130.2, "ppp": 125.1 }, ...],
      "latestActual": 184.37,
      "latestPpp": 136.7,
      "pppYear": 2025,
      "overUndervaluedPercent": 34.9,
      "note": "ユーロ圏の代表値としてドイツの数値を使用"
    },
    ...
  ]
}
```

`overUndervaluedPercent`の符号の意味は既存の対米ドル比較と同じ計算式(`(実勢 - PPP) / PPP × 100`)を踏襲するが、**文言化する際の主語が異なる**(下記UI設計を参照)。エラー時は`{ "currency": "...", "pair": "...", "error": true, "message": "..." }`(既存と同じ形)。

## バックエンド設計

### `worker/src/ppp.js`の変更

- 新規`PPP_JPY_CROSS_CURRENCIES`: 対象5通貨の設定(通貨コード、Yahooシンボル、表示ペア名、注記)。`invert`は不要(全て直接クロスシンボルのため)
- 新規`buildCrossPppByYear(baseByYear, quoteByYear)`: 2つの`{年: 値}`マップから、両方に値がある年だけを対象に`base ÷ quote`の比率マップを作る。共通する年が1つもなければ空マップを返す
- `forwardFillPpp`・`computeOverUndervaluedPercent`は既存のものをそのまま再利用

### `worker/src/index.js`の変更

`handlePpp`内で、既存の6通貨ループの後に日本円のPPPデータ(`normalizeWorldBankPpp(pppRaw, "JPN")`、既存のWorld Bankレスポンスから取得済みなので追加リクエストなし)を使い、`PPP_JPY_CROSS_CURRENCIES`をループして`crossIndicators`を組み立てる。実勢レートの取得(`fetchChart`)・月次への切り詰め(`takeRecentMonths`)は既存の対米ドル比較と同じ流れ。エラー分離も既存と同じ方針(1通貨の失敗が他に影響しない)。

## フロントエンド設計

### `js/ppp.js`の変更

- 既存の6カードの直前に「対米ドル」、新規5カードの直前に「対日本円」という小見出し(h4、既存の`.subsection-heading`クラスを再利用。新しいCSSクラスは追加しない)を追加し、対称な見出し構成にする
- 割安/割高の文言は**常に日本円を主語**にする: `overUndervaluedPercent`が正(実勢がPPPより多くの円を要する = 円が対象通貨に対して割安)の場合「JPYは{対象通貨}に対し理論値より{%}割安」、負の場合「割高」
- 期間選択は既存の`ppp-period-selector`をそのまま共有する(新しい選択UIは追加しない)
- `renderPppCard(indicator, subjectCurrency, counterCurrency)`のように引数を追加する。対米ドルカードは`subjectCurrency = indicator.currency`・`counterCurrency = null`で「{subject}は理論値より{%}割安」。対円カードは`subjectCurrency = "JPY"`・`counterCurrency = indicator.currency`で「{subject}は{counter}に対し理論値より{%}割安」(円だけでは5枚のカードのどれを指すか分からないため、対象通貨を文中に明記する)。チャート描画・ツールチップ・エラー表示の処理は完全に共通のまま、新しい関数は作らない

### `index.html` / `css/style.css`

- `ppp-grid`の直後に「対日本円」見出し(h4、`.subsection-heading`クラス)と専用グリッド`ppp-jpy-grid`(`.econ-grid`クラスを再利用)を追加する
- 既存の`ppp-grid`の直前にも「対米ドル」見出し(h4、`.subsection-heading`クラス)を追加する。CSSクラスは新規追加しない

## テスト方針

- `worker/test/ppp.test.js`: `buildCrossPppByYear`(共通年のみ計算、共通年なしで空マップ)の単体テスト追加
- `worker/test/index.test.js`: `/api/ppp`のレスポンスに`crossIndicators`が5件含まれること、実勢レートがYahooの直接クロスシンボルから逆数変換なしで取得されること、日本円のPPPデータ取得失敗時に`crossIndicators`が全滅すること、1通貨のみのYahoo取得失敗が他に影響しないこと、をテストに追加
- フロントエンドは`node --check`で構文確認し、ブラウザで実際に5枚の対円カードが表示され、文言の主語が日本円になっていることを目視確認する

## スコープ外(今回やらないこと)

- 日本円以外を基準にした比較(例: EUR基準でGBP・AUDと比較する、など)
- 対米ドル・対日本円を切り替えるUIトグル(両方常に表示する)
- 既存の対米ドルカードの表示形式・計算方法の変更
