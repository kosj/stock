import { NextRequest, NextResponse } from "next/server";
import { getChart } from "@/lib/server/yahoo-finance";
import { analyzeProfitTaking } from "@/lib/server/profit-taking";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/analysis/profit-taking
// body: { tickers: string[] }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const tickers: string[] = Array.isArray(body?.tickers) ? body.tickers : [];

    if (tickers.length === 0) {
      return NextResponse.json({ error: "tickers 배열이 필요합니다." }, { status: 400 });
    }

    const results = await Promise.allSettled(
      tickers.map(async (ticker) => {
        // 6개월 데이터: 저항선 탐색 + 다이버전스 분석에 충분한 범위
        const candles = await getChart(ticker.toUpperCase(), "6m");
        return analyzeProfitTaking(ticker.toUpperCase(), candles);
      }),
    );

    const data = results.map((r, i) =>
      r.status === "fulfilled"
        ? r.value
        : {
            ticker: tickers[i],
            triggered_count: 0,
            signals: [],
            recommendation: "hold" as const,
            summary: "분석 오류",
            resistance_level: null,
            resistance_distance_pct: null,
            insufficient_data: true,
          },
    );

    return NextResponse.json(data);
  } catch (e) {
    console.error("[profit-taking] 오류:", e);
    return NextResponse.json({ error: "분석 오류" }, { status: 500 });
  }
}
