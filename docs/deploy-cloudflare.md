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
