/**
 * POST /api/analysis/entry-point
 * body: { tickers: string[] }
 *
 * 여러 종목(주식/ETF)의 규칙 기반 기술적 진입타점(지지선·이평·밴드·손절선)을 반환.
 * 미래 예측이 아닌 과거 가격 기반 레벨 계산이다(정보 제공용, 투자자문 아님).
 */

import { NextRequest, NextResponse } from "next/server";
import { getChart } from "@/lib/server/yahoo-finance";
import { analyzeEntryPoint } from "@/lib/server/entry-point-analysis";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const tickers: string[] = Array.isArray(body?.tickers) ? body.tickers : [];
    // basket=true: ETF 등 바스켓 상품 → 개별주 기준봉 전제의 눌림목 점수를 판정 제외
    const isBasket: boolean = body?.basket === true;

    if (tickers.length === 0) {
      return NextResponse.json({ error: "tickers 배열이 필요합니다." }, { status: 400 });
    }

    const results = await Promise.allSettled(
      tickers.map(async (ticker) => {
        // 90일+: MA60 + 스윙저점 + 밴드 계산에 충분한 구간
        const candles = await getChart(ticker.toUpperCase(), "6m");
        return analyzeEntryPoint(ticker.toUpperCase(), candles, { isBasket });
      }),
    );

    const data = results.map((r, i) =>
      r.status === "fulfilled"
        ? r.value
        : {
            ticker: tickers[i], currentPrice: 0, ma20: null, ma60: null, rsi: null,
            supportPrimary: null, supportSecondary: null, bollingerLower: null,
            entryLow: null, entryHigh: null, stopLoss: null,
            state: "weak" as const, pullbackSignal: "none" as const, pullbackScore: 0,
            note: "분석 실패", insufficient_data: true,
          },
    );

    return NextResponse.json(data);
  } catch (e) {
    console.error("[entry-point] 오류:", e);
    return NextResponse.json({ error: "분석 오류" }, { status: 500 });
  }
}
