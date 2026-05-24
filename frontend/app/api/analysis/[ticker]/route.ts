import { NextRequest, NextResponse } from "next/server";
import { getFinancials, getChart } from "@/lib/server/yahoo-finance";
import { calcSignals } from "@/lib/server/indicators";
import { analyzeStock } from "@/lib/server/ai-analysis";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Ctx = { params: Promise<{ ticker: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const { ticker } = await params;
  const t = ticker.toUpperCase();
  const anthropicKey = req.headers.get("x-anthropic-key") ?? "";

  const [financials, candles] = await Promise.allSettled([
    getFinancials(t),
    getChart(t, "1y"),
  ]);

  const fin  = financials.status === "fulfilled" ? financials.value  : { ticker: t } as any;
  const cdls = candles.status   === "fulfilled" ? candles.value    : [];
  const signals = cdls.length > 0 ? calcSignals(cdls) : {};

  const result = await analyzeStock(t, fin, signals, [], anthropicKey);
  return NextResponse.json(result);
}
