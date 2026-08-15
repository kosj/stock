/**
 * POST /api/cron/auto-trade
 *
 * GitHub Actions에서 매일 16:00 KST (07:00 UTC) 호출.
 * mock_accounts가 있는 모든 사용자에 대해 자동매매 실행.
 * 인증: Authorization: Bearer <CRON_SECRET>
 *
 * 전략: TradingEngineService (Top20 기반 Sell First → Buy Next) — 수동 실행과 동일 엔진.
 *   매도: 손절(-5%) / 익절(+10%) / 랭크아웃(Top20 미포함)
 *   매수: Top20 rank 순, 최대 5종목, 균등 비중
 * 브로커: 계정별 모드(모의/실전)에 따라 getBrokerForUser가 선택 — 계정 기준 개인화.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/server/supabase";
import { TradingEngineService } from "@/lib/server/trading-engine-service";
import { getBrokerForUser } from "@/lib/server/broker-factory";

export const dynamic    = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  // ── 인증 ─────────────────────────────────────────────────────────────────
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 모의 계좌 사용자 목록 조회 ────────────────────────────────────────────
  const { data: accounts, error } = await supabase
    .from("mock_accounts")
    .select("user_id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!accounts?.length) return NextResponse.json({ message: "자동매매 대상 사용자 없음", users: 0 });

  // 위 가드로 null·빈 배열은 이미 반환됐다. 클로저 안에서는 타입 내로잉이
  // 유지되지 않으므로 non-null 지역 변수로 고정한다.
  const targets: { user_id: string }[] = accounts;

  const results: { user_id: string; result: object }[] = [];

  // ── 동시성 제한 + 시간 예산 ───────────────────────────────────────────────
  // 기존에는 전 사용자를 Promise.allSettled로 무제한 병렬 실행했다. 사용자 수가
  // 늘면 (Top20 조회 + 종목별 시세 + 주문) 호출이 동시에 폭증해 maxDuration(60s)을
  // 넘기고, 함수가 중간에 잘리면 "일부 계정만 체결된 채 중단"된다. 실제 자금이
  // 오가는 경로이므로, 동시 실행 수를 제한하고 남은 시간을 초과하면 시작하지
  // 않은 사용자는 다음 실행으로 넘긴다(멱등키가 중복 체결을 막아준다).
  const CONCURRENCY  = 3;
  const TIME_BUDGET_MS = 50_000;               // maxDuration 60s 대비 여유 10s
  const startedAt = Date.now();
  const deferred: string[] = [];

  let cursor = 0;
  async function worker() {
    while (cursor < targets.length) {
      const idx = cursor++;
      const { user_id } = targets[idx];

      // 남은 시간이 부족하면 시작하지 않는다 — 시작해놓고 잘리는 것이 더 위험하다
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        deferred.push(user_id);
        continue;
      }

      try {
        const broker = await getBrokerForUser(user_id);
        const result = await new TradingEngineService(broker).executeTrading(user_id);
        results.push({ user_id, result });
        console.log(`[cron/auto-trade] user=${user_id} buy=${result.trades_buy} sell=${result.trades_sell} skip=${result.skipped}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ user_id, result: { tickers_analyzed: 0, trades_buy: 0, trades_sell: 0, skipped: 0, details: [], error: msg } });
        console.error(`[cron/auto-trade] user=${user_id} 실패: ${msg}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));

  if (deferred.length) {
    console.warn(`[cron/auto-trade] 시간 예산 초과로 ${deferred.length}명 이월 — 다음 실행에서 처리`);
  }

  return NextResponse.json({
    success: true,
    deferred_users: deferred.length,
    deferred_reason: deferred.length ? "시간 예산 초과 — 다음 실행에서 처리" : undefined,
    run_at:  new Date().toISOString(),
    users:   results.length,
    results,
  });
}
