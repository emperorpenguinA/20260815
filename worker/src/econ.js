const BOJ_DATA_BASE = "https://www.stat-search.boj.or.jp/api/v1/getDataCode";

// 日本銀行 企業物価指数(2020年基準)の系列コード。db=PR01 の getMetadata で確認済み。
export const BOJ_SERIES = {
  ppiDomestic: "PRCG20_2200000000",
  ppiExport: "PRCG20_2400000000",
  ppiImport: "PRCG20_2600000000",
};

export function computeYoyPercent(points) {
  if (!points || points.length === 0) return null;

  const latest = points[points.length - 1];
  const yearAgoDate = shiftYear(latest.date, -1);
  const yearAgo = points.find((p) => p.date === yearAgoDate);

  if (!yearAgo || typeof latest.value !== "number" || typeof yearAgo.value !== "number" || yearAgo.value === 0) {
    return null;
  }

  return ((latest.value - yearAgo.value) / yearAgo.value) * 100;
}

function shiftYear(monthString, delta) {
  const match = /^(\d{4})-(\d{2})$/.exec(monthString || "");
  if (!match) return null;
  const year = Number(match[1]) + delta;
  return `${year}-${match[2]}`;
}

export function takeRecentMonths(points, months) {
  if (!points || points.length <= months) return points || [];
  return points.slice(points.length - months);
}

export async function fetchBojPriceIndex(seriesCode, startDate, endDate) {
  const url = `${BOJ_DATA_BASE}?format=json&lang=jp&db=PR01&startDate=${startDate}&endDate=${endDate}&code=${seriesCode}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`日銀API上流エラー: ${res.status}`);
  }
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

const ESTAT_DATA_BASE = "https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData";

// e-Statの統計表ID(statsDataId)は、e-Statへのユーザー登録・appId取得後でないと
// 確認できない外部依存値。docs/deploy-cloudflare.md の手順に沿って実際の値に
// 置き換えること(js/config.js の WORKER_BASE_URL と同じ扱いのプレースホルダー)。
export const JAPAN_CPI_STATS_DATA_ID = "0004052037";

export async function fetchJapanCpi(appId, statsDataId) {
  // statsDataId alone can return an entire table bundling many item/region
  // categories together (confirmed against the actual table this project
  // uses: 0004052037, a 47-city x 797-item x 3-measure table). Narrow the
  // request to a single series via e-Stat's classification-axis params:
  // cdCat01=0001 (総合, the all-items composite), cdArea=00000 (全国,
  // e-Stat's standard nationwide code), cdTab=1 (指数, the raw index value,
  // not one of the %-change variants — this app computes its own YoY%).
  // Confirmed against real getMetaInfo output for this table (see
  // toEstatMonthString below for the separate bug this masked).
  const url = `${ESTAT_DATA_BASE}?appId=${encodeURIComponent(appId)}&statsDataId=${encodeURIComponent(statsDataId)}&cdCat01=0001&cdArea=00000&cdTab=1&metaGetFlg=N&cntGetFlg=N`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`e-Stat上流エラー: ${res.status}`);
  }
  return res.json();
}

const ESTAT_AXIS_KEYS = [
  "@tab",
  "@area",
  "@cat01", "@cat02", "@cat03", "@cat04", "@cat05",
  "@cat06", "@cat07", "@cat08", "@cat09", "@cat10",
  "@cat11", "@cat12", "@cat13", "@cat14", "@cat15",
];

export function normalizeJapanCpi(raw) {
  const rawValues = raw?.GET_STATS_DATA?.STATISTICAL_DATA?.DATA_INF?.VALUE;
  if (!rawValues) {
    throw new Error("消費者物価指数データが見つかりません");
  }

  const list = Array.isArray(rawValues) ? rawValues : [rawValues];

  assertSingleSeries(list);

  const points = list
    .map((v) => ({ date: toEstatMonthString(v["@time"]), value: Number(v["$"]) }))
    .filter((p) => p.date !== null && !Number.isNaN(p.value))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (points.length === 0) {
    throw new Error("消費者物価指数データを解釈できませんでした(想定外の時間軸コード形式)");
  }

  return { points };
}

// e-Statのstatsdataidは統計表単位のIDで、表に複数の分類(品目・地域など)が
// 含まれている場合、分類コードがVALUE要素ごとに異なる。単一系列だけを期待する
// この関数では、複数の分類が混在したデータをそのまま1本の時系列として扱うと
// 誤った値になるため、混在を検知したら例外を投げる。
function assertSingleSeries(list) {
  for (const key of ESTAT_AXIS_KEYS) {
    if (!(key in list[0])) continue;
    const distinctValues = new Set(list.map((v) => v[key]));
    if (distinctValues.size > 1) {
      throw new Error(
        `統計表に複数の分類(${key})が含まれています。statsDataIdを「全国」「総合」のみの単一系列に絞り込んでください`
      );
    }
  }
}

// e-Statの「時間軸(年・月)」区分は、月次コード(YYYY + "00" + MM + MM、月を
// 2桁ずつ2回繰り返す — 例: "2026000707"=2026年7月)と、年度コード
// (YYYY + "10" + "0000" — 例: "2025100000"=2025年度)・暦年コード
// (YYYY + "000000" — 例: "2025000000"=2025年)が同じ表の@time値に混在する。
// 旧実装は先頭4桁を年、続く2桁をそのまま月として読んでいたため、年度コードの
// "10"を10月と誤認識して合格させる一方、月次コードは5〜6桁目が"00"のため
// 不正な月として弾いていた(実際に発生した不具合: 年次データしか出ず、常に
// 10月のみになる)。月次コードだけを厳密に一致させる。
function toEstatMonthString(time) {
  const match = /^(\d{4})00(\d{2})\2$/.exec(String(time ?? ""));
  if (!match) return null;

  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;

  return `${match[1]}-${match[2]}`;
}

const FRED_OBSERVATIONS_BASE = "https://api.stlouisfed.org/fred/series/observations";

// FRED(セントルイス連銀)の series_id。いずれも米国労働統計局(BLS)由来で
// 公開・安定している系列。
export const FRED_SERIES = {
  cpi: "CPIAUCSL",
  ppiDomestic: "PPIACO",
  ppiExport: "IQ",
  ppiImport: "IR",
};

export async function fetchUsIndicator(seriesId, apiKey) {
  const url = `${FRED_OBSERVATIONS_BASE}?series_id=${encodeURIComponent(seriesId)}&api_key=${encodeURIComponent(apiKey)}&file_type=json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`FRED上流エラー: ${res.status}`);
  }
  return res.json();
}

export function normalizeUsIndicator(raw) {
  const observations = raw?.observations;
  if (!observations || observations.length === 0) {
    throw new Error("米国の指標データが見つかりません");
  }

  const points = observations
    .map((o) => ({ date: typeof o.date === "string" ? o.date.slice(0, 7) : null, value: Number(o.value) }))
    .filter((p) => p.date !== null && !Number.isNaN(p.value));

  return { points };
}
