import { NextRequest, NextResponse } from "next/server";
import { getChart } from "@/lib/server/yahoo-finance";
import { analyzeStopLoss } from "@/lib/server/stop-loss-signal";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/analysis/stop-loss
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
        // 3개월 데이터: MA20 + 거래량 패턴 분석에 충분
        const candles = await getChart(ticker.toUpperCase(), "3m");
        return analyzeStopLoss(ticker.toUpperCase(), candles);
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
            ma20: null,
            ma20_distance_pct: null,
            max_volume_ratio: null,
            consecutive_down_days: 0,
            insufficient_data: true,
          },
    );

    return NextResponse.json(data);
  } catch (e) {
    console.error("[stop-loss] 오류:", e);
    return NextResponse.json({ error: "분석 오류" }, { status: 500 });
  }
}
