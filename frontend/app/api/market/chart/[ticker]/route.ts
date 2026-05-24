import { NextRequest, NextResponse } from "next/server";
import { getChart } from "@/lib/server/yahoo-finance";
import { calcIndicators } from "@/lib/server/indicators";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ ticker: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const { ticker } = await params;
  const period = req.nextUrl.searchParams.get("period") ?? "1y";

  const candles = await getChart(ticker.toUpperCase(), period);
  if (candles.length === 0) return NextResponse.json({ error: "차트 데이터 없음" }, { status: 404 });

  const indicators = calcIndicators(candles);

  return NextResponse.json({
    ticker,
    period,
    candles,
    indicators,
  });
}
