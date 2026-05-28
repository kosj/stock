/**
 * POST /api/cron/prophet-top10
 *
 * 매주 금요일 GitHub Actions에서 호출.
 * STOCK_UNIVERSE 전체에 Prophet 예측을 실행하고 base_return_30d 상위 10종목을
 * Supabase prophet_recommendations 테이블에 저장한다.
 *
 * 인증: Authorization: Bearer <CRON_SECRET>
 *
 * Vercel 요구사항:
 *   - maxDuration = 60  → Pro 플랜 필요 (Hobby: 10s)
 *   - 환경변수 CRON_SECRET (Vercel + GitHub Secrets 모두 등록)
 */

import { NextRequest, NextResponse } from "next/server";
import { prophetForecast } from "@/lib/server/prophet-forecast";
import { supabase } from "@/lib/server/supabase";
import { STOCK_UNIVERSE } from "@/lib/server/stock-universe";

export const dynamic    = "force-dynamic";
export const maxDuration = 60;

const PER_TICKER_TIMEOUT_MS = 12_000;

export async function POST(request: NextRequest) {
  // ── 인증 ──────────────────────────────────────────────────────────────────
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // ── Prophet 병렬 실행 (종목별 타임아웃) ───────────────────────────────────
  const settled = await Promise.allSettled(
    STOCK_UNIVERSE.map(({ ticker, name }) =>
      Promise.race([
        prophetForecast(ticker).then(r => ({ ...r, stock_name: name })),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`timeout:${ticker}`)), PER_TICKER_TIMEOUT_MS),
        ),
      ]),
    ),
  );

  const valid = settled
    .filter((r): r is PromiseFulfilledResult<ReturnType<typeof prophetForecast> extends Promise<infer T> ? T & { stock_name: string } : never> =>
      r.status === "fulfilled",
    )
    .map(r => r.value)
    .filter(r => !r.insufficient_data && r.current_price > 0 && isFinite(r.scenarios.base_return_30d));

  // base_return_30d 내림차순 정렬 → 상위 10
  valid.sort((a, b) => b.scenarios.base_return_30d - a.scenarios.base_return_30d);
  const top10 = valid.slice(0, 10);

  // ── Supabase upsert ────────────────────────────────────────────────────────
  const rows = top10.map((r, i) => ({
    run_date:             runDate,
    rank:                 i + 1,
    ticker:               r.ticker,
    name:                 r.stock_name,
    current_price:        r.current_price,
    predicted_return_7d:  r.predicted_return_7d,
    predicted_return_30d: r.predicted_return_30d,
    bull_return_30d:      r.scenarios.bull_return_30d,
    base_return_30d:      r.scenarios.base_return_30d,
    bear_return_30d:      r.scenarios.bear_return_30d,
    recommendation:       r.recommendation,
    r_squared:            r.r_squared,
    trend_direction:      r.trend_direction,
  }));

  const { error } = await supabase
    .from("prophet_recommendations")
    .upsert(rows, { onConflict: "run_date,rank" });

  if (error) {
    console.error("[cron/prophet-top10] Supabase upsert error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const top3Summary = top10.slice(0, 3).map((r, i) => ({
    rank:                 i + 1,
    ticker:               r.ticker,
    name:                 r.stock_name,
    base_return_30d:      +r.scenarios.base_return_30d.toFixed(2),
    bull_return_30d:      +r.scenarios.bull_return_30d.toFixed(2),
    bear_return_30d:      +r.scenarios.bear_return_30d.toFixed(2),
    recommendation:       r.recommendation,
  }));

  console.log(`[cron/prophet-top10] ${runDate}: ${valid.length}/${STOCK_UNIVERSE.length} 분석 완료, 상위 10 저장`);

  return NextResponse.json({
    success:   true,
    run_date:  runDate,
    analyzed:  valid.length,
    total:     STOCK_UNIVERSE.length,
    top3:      top3Summary,
  });
}
