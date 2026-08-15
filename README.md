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
