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

ローカルで`npx wrangler dev`を使って検証する場合は、`worker/.dev.vars`ファイルにシークレットを書ける(`ESTAT_APP_ID=...`のような形式)。このファイルは`.gitignore`済みなので、誤ってコミットされることはない。

### 4. 日本銀行APIについて

日本銀行の時系列統計データAPIは登録・認証が不要なため、追加設定は不要。

## 注意事項

- Yahoo Financeの非公式APIを利用しているため、Yahoo側の仕様変更やレート制限によって取得できなくなる可能性がある。その場合はWorker側のエンドポイント(`worker/src/yahoo.js`)を更新する必要がある。
- Cloudflare Workersの無料枠は1日10万リクエストまで。個人利用の範囲では通常問題にならない。
- Workerを再デプロイした場合もURLは変わらないため、`WORKER_BASE_URL` の再設定は不要。
