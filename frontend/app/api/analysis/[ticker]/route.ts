import { NextRequest, NextResponse } from "next/server";
import { getFinancials, getChart } from "@/lib/server/yahoo-finance";
import { calcSignals } from "@/lib/server/indicators";
import { analyzeStock } from "@/lib/server/ai-analysis";
import { SectorService } from "@/lib/server/sector-service";

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

  const [financials, candles, sectorPerf] = await Promise.allSettled([
    getFinancials(t),
    getChart(t, "1y"),
    SectorService.getMomentum(),
  ]);

  const fin     = financials.status === "fulfilled" ? financials.value : { ticker: t } as any;
  const cdls    = candles.status    === "fulfilled" ? candles.value    : [];
  const sectors = sectorPerf.status === "fulfilled"
    ? sectorPerf.value.map(s => ({ sector: s.sector_name ?? "", change_1m: s.return_1m }))
    : [];
  const signals = cdls.length > 0 ? calcSignals(cdls) : {};

  const result = await analyzeStock(t, fin, signals, sectors, anthropicKey, avgPrice, quantity);
  return NextResponse.json(result);
}
