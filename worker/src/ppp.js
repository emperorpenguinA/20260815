const WORLD_BANK_BASE = "https://api.worldbank.org/v2/country";
const PPP_INDICATOR = "PA.NUS.PPP";

// 対米ドルで比較する6通貨。World BankのEMU(ユーロ圏集計)はPA.NUS.PPPを
// 提供しない(実データで確認済み、valueが常にnull)ため、EURはドイツの値を
// 代表値として使う。Yahoo FinanceのFXシンボルは通貨によって向きが異なり、
// JPY=X/CNY=X/CAD=Xは「1ドル=現地通貨」だが、EURUSD=X/GBPUSD=X/AUDUSD=Xは
// 「1現地通貨=何ドル」の逆向きで返る(実データで確認済み)。invertはその
// 逆数変換が必要かどうかを示す。
export const PPP_CURRENCIES = [
  { currency: "JPY", iso3: "JPN", yahooSymbol: "JPY=X", pair: "USD/JPY", invert: false, note: null },
  {
    currency: "EUR",
    iso3: "DEU",
    yahooSymbol: "EURUSD=X",
    pair: "EUR/USD",
    invert: true,
    note: "ユーロ圏の代表値としてドイツの数値を使用",
  },
  { currency: "GBP", iso3: "GBR", yahooSymbol: "GBPUSD=X", pair: "GBP/USD", invert: true, note: null },
  { currency: "CNY", iso3: "CHN", yahooSymbol: "CNY=X", pair: "USD/CNY", invert: false, note: null },
  { currency: "AUD", iso3: "AUS", yahooSymbol: "AUDUSD=X", pair: "AUD/USD", invert: true, note: null },
  { currency: "CAD", iso3: "CAN", yahooSymbol: "CAD=X", pair: "USD/CAD", invert: false, note: null },
];

export async function fetchWorldBankPpp(iso3Codes, startYear, endYear) {
  const url = `${WORLD_BANK_BASE}/${iso3Codes.join(";")}/indicator/${PPP_INDICATOR}?format=json&date=${startYear}:${endYear}&per_page=500`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`World Bank上流エラー: ${res.status}`);
  }
  return res.json();
}

export function normalizeWorldBankPpp(raw, iso3Code) {
  const rows = raw?.[1] || [];
  const result = {};
  for (const row of rows) {
    if (row.countryiso3code !== iso3Code) continue;
    if (typeof row.value !== "number") continue;
    result[Number(row.date)] = row.value;
  }
  return result;
}

export function latestPppEntry(pppByYear) {
  const years = Object.keys(pppByYear).map(Number);
  if (years.length === 0) return null;
  const maxYear = Math.max(...years);
  return { year: maxYear, value: pppByYear[maxYear] };
}

// 年次のPPP値を、実勢レート側の月次グリッドに合わせてフォワードフィルする。
// 各月について、その月が属する年のPPP値があればそれを使い、なければ
// 「その年より前で最新の、値がある年」の値を使う(例: 今年分がまだ未公開
// なら前年の値を使う「階段状」のフィル)。該当する年が1つもなければnull。
export function forwardFillPpp(monthDates, pppByYear) {
  const years = Object.keys(pppByYear)
    .map(Number)
    .sort((a, b) => a - b);

  return monthDates.map((monthDate) => {
    const targetYear = Number(monthDate.slice(0, 4));
    let applicableYear = null;
    for (const year of years) {
      if (year <= targetYear) {
        applicableYear = year;
      } else {
        break;
      }
    }
    return applicableYear === null ? null : pppByYear[applicableYear];
  });
}

export function toLcuPerUsd(rate, invert) {
  if (typeof rate !== "number") return null;
  return invert ? 1 / rate : rate;
}

export function computeOverUndervaluedPercent(actualRate, pppRate) {
  if (typeof actualRate !== "number" || typeof pppRate !== "number" || pppRate === 0) {
    return null;
  }
  return ((actualRate - pppRate) / pppRate) * 100;
}
