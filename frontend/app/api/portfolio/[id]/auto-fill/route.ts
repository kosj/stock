import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/server/supabase";
import { getFinancials, getChart } from "@/lib/server/yahoo-finance";
import { calcSignals } from "@/lib/server/indicators";
import { analyzeStock } from "@/lib/server/ai-analysis";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

const STRATEGY_MAP: Record<string, string> = {
  "Strong Buy":  "적극 매수 — 분할 매수 후 장기 보유",
  "Buy":         "매수 — 지지선 확인 후 비중 확대",
  "Hold":        "보유 유지 — 추가 매수 보류, 모니터링",
  "Sell":        "매도 검토 — 리스크 관리 우선",
  "Strong Sell": "적극 매도 — 손절 후 현금 확보",
};

export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const anthropicKey = body.anthropic_api_key ?? "";

  const { data: pf } = await supabase.from("portfolios").select("id").eq("id", id).single();
  if (!pf) return NextResponse.json({ error: "포트폴리오를 찾을 수 없습니다." }, { status: 404 });

  const { data: positions } = await supabase.from("positions").select("*").eq("portfolio_id", id);
  if (!positions || positions.length === 0) return NextResponse.json({ updated: 0 });

  const results = await Promise.allSettled(
    positions.map(async (pos) => {
      const [financials, candles] = await Promise.allSettled([
        getFinancials(pos.ticker),
        getChart(pos.ticker, "1y"),
      ]);
      const fin  = financials.status === "fulfilled" ? financials.value  : { ticker: pos.ticker } as any;
      const cdls = candles.status === "fulfilled" ? candles.value : [];

      const signals  = cdls.length > 0 ? calcSignals(cdls) : {};
      const analysis = await analyzeStock(pos.ticker, fin, signals, [], anthropicKey);

      const rec   = analysis.recommendation;
      const score = analysis.score;
      const updates: Record<string, unknown> = {
        strategy:   `${STRATEGY_MAP[rec] ?? rec} (AI 점수: ${score}/100)`,
        updated_at: new Date().toISOString(),
      };
      if (analysis.stop_price)   updates.stop_loss   = analysis.stop_price;
      if (analysis.target_price) updates.take_profit = analysis.target_price;

      await supabase.from("positions").update(updates).eq("id", pos.id);
    })
  );

  const updated = results.filter((r) => r.status === "fulfilled").length;
  return NextResponse.json({ updated });
}
