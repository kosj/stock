import { NextRequest, NextResponse } from "next/server";
import { getChart } from "@/lib/server/yahoo-finance";
import { analyzePullback } from "@/lib/server/pullback-analysis";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/analysis/pullback
// body: { tickers: string[] }
// 여러 종목을 병렬 분석하여 눌림목 패턴 결과 반환
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const tickers: string[] = Array.isArray(body?.tickers) ? body.tickers : [];

    if (tickers.length === 0) {
      return NextResponse.json({ error: "tickers 배열이 필요합니다." }, { status: 400 });
    }

    const results = await Promise.allSettled(
      tickers.map(async (ticker) => {
        // 90일 데이터: MA60 + RSI14 + 여유분 확보
        const candles = await getChart(ticker.toUpperCase(), "3m");
        return analyzePullback(ticker.toUpperCase(), candles);
      }),
    );

    const data = results.map((r, i) =>
      r.status === "fulfilled"
        ? r.value
        : {
            ticker: tickers[i],
            score: 0,
            signal: "none" as const,
            insufficient_data: true,
            stage1_pass: false, stage2_pass: false,
            stage3_pass: false, stage4_pass: false,
          },
    );

    return NextResponse.json(data);
  } catch (e) {
    console.error("[pullback] 오류:", e);
    return NextResponse.json({ error: "분석 오류" }, { status: 500 });
  }
}
