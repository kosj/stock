import { NextRequest, NextResponse } from "next/server";
import { InvestorTrendService } from "@/lib/server/investor-trend";

export const revalidate = 3600; // 1시간 — 수급 데이터는 장 중 빈번한 갱신 불필요

type Ctx = { params: Promise<{ ticker: string }> };

/**
 * GET /api/market/investor-trend/[ticker]
 * 최근 5영업일 외국인/기관 순매수 트렌드 반환 (국내 종목 전용)
 */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { ticker } = await params;
  const code = ticker.toUpperCase();

  const result = await InvestorTrendService.getTrend(code);
  if (!result) {
    return NextResponse.json(
      { error: "국내 6자리 종목코드만 지원합니다." },
      { status: 400 },
    );
  }

  return NextResponse.json(result);
}
