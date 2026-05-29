import { NextRequest, NextResponse } from "next/server";
import { KrxService } from "@/lib/server/krx-service";

export const dynamic    = "force-dynamic";
export const maxDuration = 15;

type Ctx = { params: Promise<{ ticker: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { ticker } = await params;
  const days = 5;

  try {
    const data = await KrxService.getStockInvestorTrend(ticker, days);
    return NextResponse.json({ ticker, data });
  } catch {
    return NextResponse.json({ ticker, data: [] });
  }
}
