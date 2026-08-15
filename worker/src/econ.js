const BOJ_DATA_BASE = "https://www.stat-search.boj.or.jp/api/v1/getDataCode";

// 日本銀行 企業物価指数(2020年基準)の系列コード。db=PR01 の getMetadata で確認済み。
export const BOJ_SERIES = {
  ppiDomestic: "PRCG20_2200000000",
  ppiExport: "PRCG20_2400000000",
  ppiImport: "PRCG20_2600000000",
};

export function computeYoyPercent(points) {
  if (!points || points.length < 13) return null;

  const latest = points[points.length - 1];
  const yearAgo = points[points.length - 13];
  if (typeof latest.value !== "number" || typeof yearAgo.value !== "number" || yearAgo.value === 0) {
    return null;
  }

  return ((latest.value - yearAgo.value) / yearAgo.value) * 100;
}

export function takeRecentMonths(points, months) {
  if (!points || points.length <= months) return points || [];
  return points.slice(points.length - months);
}

export async function fetchBojPriceIndex(seriesCode, startDate, endDate) {
  const url = `${BOJ_DATA_BASE}?format=json&lang=jp&db=PR01&startDate=${startDate}&endDate=${endDate}&code=${seriesCode}`;
  const res = await fetch(url);
  return res.json();
}

export function normalizeBojPriceIndex(raw) {
  const series = raw?.RESULTSET?.[0];
  if (!series) {
    throw new Error("日銀統計データが見つかりません");
  }

  const dates = series.VALUES?.SURVEY_DATES || [];
  const values = series.VALUES?.VALUES || [];

  const points = dates
    .map((yyyymm, i) => ({ date: toMonthString(yyyymm), value: values[i] }))
    .filter((p) => typeof p.value === "number");

  return { points };
}

function toMonthString(yyyymm) {
  const s = String(yyyymm);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}`;
}
