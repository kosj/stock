import { NextRequest, NextResponse } from "next/server";
import { getChart, toYahooTicker } from "@/lib/server/yahoo-finance";
import { calcIndicators } from "@/lib/server/indicators";
import { calculateRelativeStrength } from "@/lib/server/relative-strength";

export const maxDuration = 30;
export const revalidate  = 300; // 5분 — 일봉 데이터, 잦은 갱신 불필요. force-dynamic 제거해야 revalidate 작동

type Ctx = { params: Promise<{ ticker: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const { ticker } = await params;
  const t      = ticker.toUpperCase();
  const period = req.nextUrl.searchParams.get("period") ?? "1y";

  // 종목 차트 + KOSPI 차트 병렬 조회 — RS 계산을 위해 동시 fetch
  const [candles, kospiCandles] = await Promise.all([
    getChart(t, period),
    getChart(toYahooTicker("KS11"), period), // ^KS11 KOSPI
  ]);

  if (candles.length === 0) return NextResponse.json({ error: "차트 데이터 없음" }, { status: 404 });

  const indicators = calcIndicators(candles);

  // 상대 강도 계산 — KOSPI 데이터가 충분할 때만
  const rs = kospiCandles.length >= 5
    ? calculateRelativeStrength(candles, kospiCandles)
    : null;

  return NextResponse.json({
    ticker: t,
    period,
    candles,
    indicators,
    rs, // null이면 프론트에서 RS 기능 비활성화
  });
}
