/**
 * GET /api/etfs/drawdown?tickers=360750,133690,...
 *
 * 각 종목의 52주(1년) 전고점 대비 현재 등락률을 반환한다.
 * 연금 가이드의 "하락장 추가매수 트리거(전고점 대비)"를 예시 수치가 아닌
 * 실측값으로 판단할 수 있게 하는 데이터 소스.
 *
 * 산식: drawdownPct = (현재종가 / 1년 최고종가 − 1) × 100  (0 = 신고가, 음수 = 낙폭)
 */

import { NextRequest, NextResponse } from "next/server";
import { getChart } from "@/lib/server/yahoo-finance";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_TICKERS = 15;

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("tickers") ?? "";
  const tickers = [...new Set(raw.split(",").map((t) => t.trim()).filter((t) => /^\d{6}$/.test(t)))]
    .slice(0, MAX_TICKERS);

  if (tickers.length === 0) {
    return NextResponse.json({ error: "tickers(6자리 코드, 콤마 구분)가 필요합니다." }, { status: 400 });
  }

  const results = await Promise.all(
    tickers.map(async (ticker) => {
      try {
        const candles = await getChart(ticker, "1y");
        const closes = (candles ?? []).map((c) => c.close).filter((v) => v > 0);
        if (closes.length < 20) return { ticker, ok: false };
        const price  = closes[closes.length - 1];
        const high52 = Math.max(...closes);
        return {
          ticker,
          ok: true,
          price,
          high52w: high52,
          drawdownPct: Math.round((price / high52 - 1) * 10000) / 100,
        };
      } catch {
        return { ticker, ok: false };
      }
    }),
  );

  return NextResponse.json(
    { updated_at: new Date().toISOString(), items: results },
    { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=600" } },
  );
}
