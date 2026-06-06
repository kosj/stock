/**
 * POST /api/cron/prophet-top10
 *
 * 매일 오후 4:00 KST (07:00 UTC) GitHub Actions에서 호출.
 *
 * ┌ 파이프라인 ─────────────────────────────────────────────────────────────────┐
 * │ Step 1. 시총 5000억 미만 제거                                               │
 * │ Step 2. Hybrid Stacking Ensemble 병렬 실행 (종목당 12s 타임아웃)           │
 * │ Step 3. 리스크 조정 복합 스코어 계산 후 상위 30 선정                        │
 * │   ① 복합 수익률  = 0.6 × return30d + 0.4 × return5d                       │
 * │   ② 리스크 조정  = 복합 수익률 / atr_pct  (샤프 비율 아날로그)             │
 * │   ③ 섹터 캡      = 동일 섹터 최대 5개 (쏠림 방지)                          │
 * │ Step 4. Supabase upsert                                                     │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * 인증: Authorization: Bearer <CRON_SECRET>
 */

import { NextRequest, NextResponse } from "next/server";
import { prophetForecast } from "@/lib/server/prophet-forecast";
import { getQuote } from "@/lib/server/yahoo-finance";
import { supabase } from "@/lib/server/supabase";
import { STOCK_UNIVERSE, MIN_MARKET_CAP_KRW } from "@/lib/server/stock-universe";

export const dynamic    = "force-dynamic";
export const maxDuration = 60;

const PER_TICKER_TIMEOUT_MS = 12_000;

/**
 * 섹터별 최대 포함 종목 수.
 * 반도체·2차전지 등 특정 섹터가 Top 30을 독점하는 쏠림(concentration risk) 방지.
 * 예: 반도체 4종 모두 상위권이어도 최대 5개까지만 포함.
 */
const SECTOR_MAX_COUNT = 5;

/**
 * 복합 수익률 가중치
 *   - 30일(중기) 예측: 0.6 — 추세 방향성 중심
 *   - 5일(단기) 예측:  0.4 — 모멘텀 민감도 보완
 * 5일 예측이 30일보다 일반적으로 더 정확하므로 보조 신호로 활용.
 */
const WEIGHT_30D = 0.6;
const WEIGHT_5D  = 0.4;

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
    if (r.status !== "fulfilled" || !r.value) return true;
    const cap = r.value.market_cap;
    if (cap === null || cap === undefined) return true;
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

  type ForecastRow = Awaited<ReturnType<typeof prophetForecast>> & {
    stock_name:             string;
    sector:                 string;
    composite_return:       number;
    risk_adjusted_score:    number;
  };

  // ── Step 3-A: 복합 스코어 계산 ───────────────────────────────────────────
  //
  // ┌ 공식 ───────────────────────────────────────────────────────────────────┐
  // │                                                                         │
  // │  composite_return = 0.6 × base_return_30d + 0.4 × predicted_return_5d  │
  // │                                                                         │
  // │  risk_adjusted_score = composite_return / atr_pct                       │
  // │                                                                         │
  // │  직관: 같은 기대 수익률이라면 변동성(ATR%)이 낮은 종목이 더 유리.       │
  // │        예) 수익률 +9%, ATR% 3% → score=3.0                             │
  // │            수익률 +12%, ATR% 9% → score=1.33  ← 더 낮음                │
  // │        → 고변동성 대비 실질 수익이 높은 종목 선별 (Sharpe 아날로그)     │
  // │                                                                         │
  // │  atr_pct 최솟값: ATR_PCT_FLOOR=0.5% (prophetForecast 내부에서 클램핑)  │
  // │  → 0으로 나누기 방지 보장 (atr_pct는 항상 0.5 이상)                    │
  // │                                                                         │
  // └─────────────────────────────────────────────────────────────────────────┘
  const scored: ForecastRow[] = [];

  settled.forEach((r, i) => {
    if (r.status !== "fulfilled") return;

    const f = r.value;
    if (f.insufficient_data || f.current_price <= 0 || !isFinite(f.scenarios.base_return_30d)) return;

    const composite_return =
      WEIGHT_30D * f.scenarios.base_return_30d +
      WEIGHT_5D  * f.predicted_return_5d;

    // atr_pct는 prophetForecast 내부에서 [0.5, 12.0] 클램핑 보장 → 0 나누기 없음
    const risk_adjusted_score = composite_return / f.atr_pct;

    scored.push({
      ...f,
      stock_name:          candidates[i].name,
      sector:              candidates[i].sector,
      composite_return,
      risk_adjusted_score,
    });
  });

  // 리스크 조정 스코어 내림차순 정렬
  scored.sort((a, b) => b.risk_adjusted_score - a.risk_adjusted_score);

  // ── Step 3-B: 섹터 캡 적용 → 상위 30 선정 ───────────────────────────────
  //
  // 알고리즘:
  //   - risk_adjusted_score 내림차순으로 순회
  //   - 해당 섹터 포함 카운트 < SECTOR_MAX_COUNT(5)인 경우만 추가
  //   - 30개 채우면 종료
  //
  // 효과:
  //   - 단일 섹터 최대 5개 → 섹터 쏠림(concentration risk) 방지
  //   - 섹터 내에서는 여전히 스코어 순 → 섹터 내 최우수 종목 선별
  //   - 전체 순서는 스코어 기준 유지 → 공정성 보장
  const top30: ForecastRow[]             = [];
  const sectorCount = new Map<string, number>();

  for (const item of scored) {
    if (top30.length >= 30) break;

    const currentCount = sectorCount.get(item.sector) ?? 0;
    if (currentCount >= SECTOR_MAX_COUNT) {
      // 이 섹터는 이미 최대치 → 건너뜀
      continue;
    }

    top30.push(item);
    sectorCount.set(item.sector, currentCount + 1);
  }

  // ── Step 4: Supabase upsert ───────────────────────────────────────────────
  const rows = top30.map((r, i) => ({
    run_date:             runDate,
    rank:                 i + 1,
    ticker:               r.ticker,
    name:                 r.stock_name,
    market:               STOCK_UNIVERSE.find(s => s.ticker === r.ticker)?.market ?? "KOSPI",
    sector:               r.sector,
    current_price:        r.current_price,
    predicted_return_7d:  r.predicted_return_7d,
    predicted_return_30d: r.predicted_return_30d,
    bull_return_30d:      r.scenarios.bull_return_30d,
    base_return_30d:      r.scenarios.base_return_30d,
    bear_return_30d:      r.scenarios.bear_return_30d,
    recommendation:       r.recommendation,
    r_squared:            r.r_squared,
    trend_direction:      r.trend_direction,
    // 신규 컬럼: 복합 스코어 + 리스크 지표
    composite_return:     r.composite_return,
    risk_adjusted_score:  r.risk_adjusted_score,
    atr_pct:              r.atr_pct,
    // 과거 5일 예측 vs 실제
    accuracy_json: JSON.stringify(
      r.history_actual.slice(-5).map((a, idx) => {
        const fit     = r.history_fit.slice(-5)[idx];
        const diff    = fit ? a.price - fit.yhat : 0;
        const diffPct = fit && fit.yhat ? (diff / fit.yhat) * 100 : 0;
        return {
          date:      a.date,
          actual:    a.price,
          predicted: fit ? fit.yhat : null,
          diff,
          diff_pct:  diffPct,
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

  // ── 응답 요약 ─────────────────────────────────────────────────────────────
  const sectorSummary = Object.fromEntries(
    Array.from(sectorCount.entries()).sort((a, b) => b[1] - a[1]),
  );

  const top3Summary = top30.slice(0, 3).map((r, i) => ({
    rank:                 i + 1,
    ticker:               r.ticker,
    name:                 r.stock_name,
    sector:               r.sector,
    base_return_30d:      +r.scenarios.base_return_30d.toFixed(2),
    predicted_return_5d:  +r.predicted_return_5d.toFixed(2),
    composite_return:     +r.composite_return.toFixed(2),
    atr_pct:              +r.atr_pct.toFixed(2),
    risk_adjusted_score:  +r.risk_adjusted_score.toFixed(3),
    recommendation:       r.recommendation,
  }));

  console.log(`[cron] ${runDate}: ${scored.length}/${candidates.length} 분석, 상위 30 저장`);
  console.log(`[cron] 섹터 분포:`, sectorSummary);

  return NextResponse.json({
    success:        true,
    run_date:       runDate,
    filtered:       candidates.length,
    analyzed:       scored.length,
    total:          STOCK_UNIVERSE.length,
    sector_summary: sectorSummary,
    top3:           top3Summary,
  });
}
