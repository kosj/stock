import { NextRequest, NextResponse } from "next/server";
import { getFinancials, getChart, toYahooTicker } from "@/lib/server/yahoo-finance";
import { calcSignals } from "@/lib/server/indicators";
import { analyzeStock } from "@/lib/server/ai-analysis";
import { SectorService } from "@/lib/server/sector-service";
import { calculateRelativeStrength } from "@/lib/server/relative-strength";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Ctx = { params: Promise<{ ticker: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const { ticker } = await params;
  const t = ticker.toUpperCase();
  const anthropicKey = req.headers.get("x-anthropic-key") ?? "";

  const url = new URL(req.url);
  const avgPrice = parseFloat(url.searchParams.get("avg_price") ?? "") || null;
  const quantity = parseInt(url.searchParams.get("quantity") ?? "", 10) || null;

  // 종목 차트 + KOSPI 차트를 병렬 조회 — RS Outperformer 판단에 활용
  const [financials, candles, kospiCandles, sectorPerf] = await Promise.allSettled([
    getFinancials(t),
    getChart(t, "1y"),
    getChart(toYahooTicker("KS11"), "1y"),
    SectorService.getMomentum(),
  ]);

  const fin     = financials.status === "fulfilled" ? financials.value : { ticker: t } as any;
  const cdls    = candles.status    === "fulfilled" ? candles.value    : [];
  const kospi   = kospiCandles.status === "fulfilled" ? kospiCandles.value : [];
  const sectors = sectorPerf.status === "fulfilled"
    ? sectorPerf.value.map(s => ({ sector: s.sector_name ?? "", change_1m: s.return_1m }))
    : [];
  const signals = cdls.length > 0 ? calcSignals(cdls) : {};

  // 상대 강도 계산 — AI 퀀트 스코어 반영용
  const rs = cdls.length >= 5 && kospi.length >= 5
    ? calculateRelativeStrength(cdls, kospi)
    : null;

  const result = await analyzeStock(
    t, fin, signals, sectors, anthropicKey, avgPrice, quantity,
    rs?.is_outperformer ?? false,
  );
  return NextResponse.json(result);
}
