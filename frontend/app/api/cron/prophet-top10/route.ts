/**
 * POST /api/cron/prophet-top10
 *
 * 매일 오후 4:00 KST (07:00 UTC) GitHub Actions에서 호출.
 * 1. 시총 5000억 미만 종목 사전 제거 (getQuote.market_cap 기준)
 * 2. 통과 종목에 하이브리드 스태킹 앙상블 예측 실행
 * 3. base_return_30d 상위 30종목을 Supabase에 저장
 *
 * 인증: Authorization: Bearer <CRON_SECRET>
 * Vercel Pro: maxDuration=60 필요 (Hobby=10s)
 */

import { NextRequest, NextResponse } from "next/server";
import { prophetForecast } from "@/lib/server/prophet-forecast";
import { getQuote } from "@/lib/server/yahoo-finance";
import { supabase } from "@/lib/server/supabase";
import { STOCK_UNIVERSE, MIN_MARKET_CAP_KRW } from "@/lib/server/stock-universe";

export const dynamic    = "force-dynamic";
export const maxDuration = 60;

const PER_TICKER_TIMEOUT_MS = 12_000;

export async function POST(request: NextRequest) {
  // ── 인증 ──────────────────────────────────────────────────────────────────
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runDate = new Date().toISOString().slice(0, 10);

  // ── Step 1: 시총 사전 필터 ────────────────────────────────────────────────
  const quoteSettled = await Promise.allSettled(
    STOCK_UNIVERSE.map(s => getQuote(s.ticker)),
  );

  const candidates = STOCK_UNIVERSE.filter((_, i) => {
    const r = quoteSettled[i];
    if (r.status !== "fulfilled" || !r.value) return true; // 조회 실패 → 일단 포함
    const cap = r.value.market_cap;
    if (cap === null || cap === undefined) return true;     // 시총 없음 → 일단 포함
    return cap >= MIN_MARKET_CAP_KRW;
  });

  console.log(`[cron] 시총 필터: ${STOCK_UNIVERSE.length} → ${candidates.length}종목`);

  // ── Step 2: 하이브리드 스태킹 앙상블 병렬 분석 ───────────────────────────
  const settled = await Promise.allSettled(
    candidates.map(({ ticker, name }) =>
      Promise.race([
        prophetForecast(ticker).then(r => ({ ...r, stock_name: name })),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`timeout:${ticker}`)), PER_TICKER_TIMEOUT_MS),
        ),
      ]),
    ),
  );

  type ForecastWithName = Awaited<ReturnType<typeof prophetForecast>> & { stock_name: string };

  const valid = settled
    .filter((r): r is PromiseFulfilledResult<ForecastWithName> => r.status === "fulfilled")
    .map(r => r.value)
    .filter(r => !r.insufficient_data && r.current_price > 0 && isFinite(r.scenarios.base_return_30d));

  // base_return_30d 내림차순 → 상위 30
  valid.sort((a, b) => b.scenarios.base_return_30d - a.scenarios.base_return_30d);
  const top30 = valid.slice(0, 30);

  // ── Step 3: 상위 30 Supabase upsert ──────────────────────────────────────
  const stockMap = new Map(candidates.map(s => [s.ticker, s]));

  const rows = top30.map((r, i) => ({
    run_date:             runDate,
    rank:                 i + 1,
    ticker:               r.ticker,
    name:                 r.stock_name,
    market:               stockMap.get(r.ticker)?.market  ?? "KOSPI",
    sector:               stockMap.get(r.ticker)?.sector  ?? "",
    current_price:        r.current_price,
    predicted_return_7d:  r.predicted_return_7d,
    predicted_return_30d: r.predicted_return_30d,
    bull_return_30d:      r.scenarios.bull_return_30d,
    base_return_30d:      r.scenarios.base_return_30d,
    bear_return_30d:      r.scenarios.bear_return_30d,
    recommendation:       r.recommendation,
    r_squared:            r.r_squared,
    trend_direction:      r.trend_direction,
    // 과거 5일 예측 vs 실제 (JSON)
    accuracy_json: JSON.stringify(
      r.history_actual.slice(-5).map((a, idx) => {
        const fit = r.history_fit.slice(-5)[idx];
        const diff = fit ? a.price - fit.yhat : 0;
        const diffPct = fit && fit.yhat ? (diff / fit.yhat) * 100 : 0;
        return {
          date:       a.date,
          actual:     a.price,
          predicted:  fit ? fit.yhat : null,
          diff:       diff,
          diff_pct:   diffPct,
        };
      }),
    ),
  }));

  const { error } = await supabase
    .from("prophet_recommendations")
    .upsert(rows, { onConflict: "run_date,rank" });

  if (error) {
    console.error("[cron/prophet-top10] Supabase upsert error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const top3Summary = top30.slice(0, 3).map((r, i) => ({
    rank:            i + 1,
    ticker:          r.ticker,
    name:            r.stock_name,
    base_return_30d: +r.scenarios.base_return_30d.toFixed(2),
    bull_return_30d: +r.scenarios.bull_return_30d.toFixed(2),
    bear_return_30d: +r.scenarios.bear_return_30d.toFixed(2),
    recommendation:  r.recommendation,
  }));

  console.log(`[cron] ${runDate}: ${valid.length}/${candidates.length} 분석, 상위 30 저장`);

  return NextResponse.json({
    success:  true,
    run_date: runDate,
    filtered: candidates.length,
    analyzed: valid.length,
    total:    STOCK_UNIVERSE.length,
    top3:     top3Summary,
  });
}
