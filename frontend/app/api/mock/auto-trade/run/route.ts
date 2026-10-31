/**
 * POST /api/mock/auto-trade/run
 * UI에서 수동으로 자동매매를 실행 — 현재 로그인 사용자만 대상
 *
 * 전략: TradingEngineService (Top 20 기반 Sell First → Buy Next)
 *   매도: 손절(-5%) / 순위 15위 초과 또는 Top20 미포함
 *   매수: 상위 5위, 최대 5종목, 계좌 금액 기준 집중도 한도
 */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/require-user";
import { TradingEngineService } from "@/lib/server/trading-engine-service";
import { getBrokerForUser } from "@/lib/server/broker-factory";

export const dynamic     = "force-dynamic";
export const maxDuration = 45;

export async function POST() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  // 계정별 모드(모의/실전)에 맞는 브로커 주입 — Cron 경로와 동일 엔진/동일 정합
  const broker = await getBrokerForUser(auth.userId);
  const result = await new TradingEngineService(broker).executeTrading(auth.userId);
  return NextResponse.json(result, { status: result.error ? 503 : 200 });
}
