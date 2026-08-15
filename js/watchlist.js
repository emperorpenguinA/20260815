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
