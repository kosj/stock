/**
 * POST /api/cron/auto-trade
 *
 * GitHub Actions에서 매일 16:00 KST (07:00 UTC) 호출.
 * mock_accounts가 있는 모든 사용자에 대해 자동매매 실행.
 * 인증: Authorization: Bearer <CRON_SECRET>
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/server/supabase";
import { runAutoTrade } from "@/lib/server/auto-trade-engine";

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

  const results: { user_id: string; result: object }[] = [];

  // 사용자별 자동매매는 독립 계좌이므로 병렬 실행 가능
  const settled = await Promise.allSettled(
    accounts.map(({ user_id }) => runAutoTrade(user_id))
  );

  for (let i = 0; i < accounts.length; i++) {
    const { user_id } = accounts[i];
    const s = settled[i];
    const result = s.status === "fulfilled"
      ? s.value
      : { tickers_analyzed: 0, trades_buy: 0, trades_sell: 0, skipped: 0, details: [], error: String(s.reason) };
    results.push({ user_id, result });
    console.log(`[cron/auto-trade] user=${user_id} buy=${result.trades_buy} sell=${result.trades_sell} skip=${result.skipped}`);
  }

  return NextResponse.json({
    success: true,
    run_at:  new Date().toISOString(),
    users:   results.length,
    results,
  });
}
