// Placeholder URL — will be replaced with actual Worker URL after Task 9 deployment
export const WORKER_BASE_URL = "https://investment-dashboard-proxy.YOUR-SUBDOMAIN.workers.dev";

export const DEFAULT_WATCHLIST = [
  { symbol: "^N225", name: "日経平均株価" },
  { symbol: "^GSPC", name: "S&P500" },
  { symbol: "JPY=X", name: "米ドル/円" },
];

export const WATCHLIST_STORAGE_KEY = "investment-dashboard:watchlist";
