import { NextRequest, NextResponse } from "next/server";
import { getQuote } from "@/lib/server/yahoo-finance";
import { getMacroDashboard } from "@/lib/server/fred";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// 인덱스 및 환율 티커
const INDEX_TICKERS = [
  { key: "usd_krw", ticker: "USD/KRW",  name: "달러/원",   unit: "₩" },
  { key: "eur_usd", ticker: "EUR/USD",  name: "유로/달러", unit: "$" },
  { key: "kospi",   ticker: "KS11",     name: "KOSPI",     unit: "pt" },
  { key: "kosdaq",  ticker: "KQ11",     name: "KOSDAQ",    unit: "pt" },
  { key: "sp500",   ticker: "S&P500",   name: "S&P 500",   unit: "pt" },
  { key: "nasdaq",  ticker: "IXIC",     name: "NASDAQ",    unit: "pt" },
] as const;

export async function GET(req: NextRequest) {
  const fredKey = req.headers.get("x-fred-key") ?? process.env.FRED_API_KEY ?? "";

  // FRED 데이터 + Yahoo Finance 시세 병렬 조회
  const [fredData, ...quoteResults] = await Promise.allSettled([
    getMacroDashboard(fredKey),
    ...INDEX_TICKERS.map(({ ticker }) => getQuote(ticker)),
  ]);

  const dashboard: Record<string, unknown> =
    fredData.status === "fulfilled" ? fredData.value : {};

  // Yahoo Finance 인덱스/환율 데이터를 FRED 형식으로 변환
  INDEX_TICKERS.forEach(({ key, name, unit }, i) => {
    const r = quoteResults[i];
    if (r.status !== "fulfilled" || !r.value) return;
    const q = r.value;
    dashboard[key] = {
      name,
      value:      Math.round(q.price * 100) / 100,
      prev_value: Math.round(q.prev_close * 100) / 100,
      change:     Math.round(q.change * 100) / 100,
      change_pct: Math.round(q.change_pct * 100) / 100,
      unit,
      date:       new Date().toISOString().slice(0, 10),
      series:     [],
    };
  });

  return NextResponse.json(dashboard);
}
