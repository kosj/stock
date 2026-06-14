/**
 * POST /api/mock/auto-trade/run
 * UI에서 수동으로 자동매매를 실행 — 현재 로그인 사용자만 대상
 *
 * 전략: TradingEngineService (Top 20 기반 Sell First → Buy Next)
 *   매도: 손절(-5%) / 익절(+10%) / 랭크아웃(Top20 미포함)
 *   매수: Top20 rank 순, 최대 5종목, 균등 비중
 */

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TradingEngineService } from "@/lib/server/trading-engine-service";
import { getBrokerForUser } from "@/lib/server/broker-factory";

export const dynamic     = "force-dynamic";
export const maxDuration = 45;

export async function POST() {
  const client = await createSupabaseServerClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  // 계정별 모드(모의/실전)에 맞는 브로커 주입 — Cron 경로와 동일 엔진/동일 정합
  const broker = await getBrokerForUser(user.id);
  const result = await new TradingEngineService(broker).executeTrading(user.id);
  return NextResponse.json(result);
}
