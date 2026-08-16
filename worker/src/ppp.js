const WORLD_BANK_BASE = "https://api.worldbank.org/v2/country";
const PPP_INDICATOR = "PA.NUS.PPP";

// 対米ドルで比較する10通貨。World BankのEMU(ユーロ圏集計)はPA.NUS.PPPを
// 提供しない(実データで確認済み、valueが常にnull)ため、EURはドイツの値を
// 代表値として使う。Yahoo FinanceのFXシンボルは通貨によって向きが異なり、
// JPY=X/CNY=X/CAD=X/TRY=X/MXN=X/ZAR=Xは「1ドル=現地通貨」だが、EURUSD=X/GBPUSD=X/AUDUSD=X/NZDUSD=Xは
// 「1現地通貨=何ドル」の逆向きで返る(実データで確認済み)。invertはその
// 逆数変換が必要かどうかを示す。
export const PPP_CURRENCIES = [
  { currency: "JPY", iso3: "JPN", yahooSymbol: "JPY=X", pair: "USD/JPY", invert: false, note: null },
  {
    currency: "EUR",
    iso3: "DEU",
    yahooSymbol: "EURUSD=X",
    pair: "USD/EUR",
    invert: true,
    note: "ユーロ圏の代表値としてドイツの数値を使用",
  },
  { currency: "GBP", iso3: "GBR", yahooSymbol: "GBPUSD=X", pair: "USD/GBP", invert: true, note: null },
  { currency: "CNY", iso3: "CHN", yahooSymbol: "CNY=X", pair: "USD/CNY", invert: false, note: null },
  { currency: "AUD", iso3: "AUS", yahooSymbol: "AUDUSD=X", pair: "USD/AUD", invert: true, note: null },
  { currency: "CAD", iso3: "CAN", yahooSymbol: "CAD=X", pair: "USD/CAD", invert: false, note: null },
  { currency: "NZD", iso3: "NZL", yahooSymbol: "NZDUSD=X", pair: "USD/NZD", invert: true, note: null },
  { currency: "TRY", iso3: "TUR", yahooSymbol: "TRY=X", pair: "USD/TRY", invert: false, note: null },
  { currency: "MXN", iso3: "MEX", yahooSymbol: "MXN=X", pair: "USD/MXN", invert: false, note: null },
  { currency: "ZAR", iso3: "ZAF", yahooSymbol: "ZAR=X", pair: "USD/ZAR", invert: false, note: null },
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

// 対米ドル比較のEURと同じく、World BankのEMU集計にPA.NUS.PPPがないため
// ドイツを代表値として使う。Yahooのクロスシンボルは全て「1外貨=何円」の
// 直接クオートで返る(実データで確認済み)ため、対米ドル比較のEUR/GBP/AUDと
// 違い逆数変換は不要。
export const PPP_JPY_CROSS_CURRENCIES = [
  {
    currency: "EUR",
    iso3: "DEU",
    yahooSymbol: "EURJPY=X",
    pair: "EUR/JPY",
    note: "ユーロ圏の代表値としてドイツの数値を使用",
  },
  { currency: "GBP", iso3: "GBR", yahooSymbol: "GBPJPY=X", pair: "GBP/JPY", note: null },
  { currency: "CNY", iso3: "CHN", yahooSymbol: "CNYJPY=X", pair: "CNY/JPY", note: null },
  { currency: "AUD", iso3: "AUS", yahooSymbol: "AUDJPY=X", pair: "AUD/JPY", note: null },
  { currency: "CAD", iso3: "CAN", yahooSymbol: "CADJPY=X", pair: "CAD/JPY", note: null },
  { currency: "NZD", iso3: "NZL", yahooSymbol: "NZDJPY=X", pair: "NZD/JPY", note: null },
  { currency: "TRY", iso3: "TUR", yahooSymbol: "TRYJPY=X", pair: "TRY/JPY", note: null },
  { currency: "MXN", iso3: "MEX", yahooSymbol: "MXNJPY=X", pair: "MXN/JPY", note: null },
  { currency: "ZAR", iso3: "ZAF", yahooSymbol: "ZARJPY=X", pair: "ZAR/JPY", note: null },
];

// 日本円(base)と対象通貨(quote)、両方のPPP変換係数がそろっている年だけを
// 対象に、base÷quoteの比率を年ごとに計算する。forwardFillPppにそのまま
// 渡せる{年: 値}の形で返す。
export function buildCrossPppByYear(baseByYear, quoteByYear) {
  const result = {};
  for (const year of Object.keys(baseByYear)) {
    if (!(year in quoteByYear)) continue;
    result[year] = baseByYear[year] / quoteByYear[year];
  }
  return result;
}
