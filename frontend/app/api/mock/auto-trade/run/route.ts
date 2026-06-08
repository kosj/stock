/**
 * POST /api/mock/auto-trade/run
 * UI에서 수동으로 자동매매를 실행 — 현재 로그인 사용자만 대상
 *
 * 전략: TradingEngineService (Top 30 기반 Sell First → Buy Next)
 *   매도: 손절(-5%) / 익절(+10%) / 랭크아웃(Top30 미포함)
 *   매수: Top30 rank 순, 최대 5종목, 균등 비중
 */

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TradingEngineService } from "@/lib/server/trading-engine-service";

export const dynamic     = "force-dynamic";
export const maxDuration = 45;

export async function POST() {
  const client = await createSupabaseServerClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const engine = new TradingEngineService();
  const result = await engine.executeTrading(user.id);
  return NextResponse.json(result);
}
