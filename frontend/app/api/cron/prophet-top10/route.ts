/**
 * POST /api/cron/prophet-top10
 *
 * 매일 오후 4:00 KST (07:00 UTC) GitHub Actions에서 호출.
 *
 * ┌ 파이프라인 ─────────────────────────────────────────────────────────────────┐
 * │ Step 1.  시총 5000억 미만 제거                                              │
 * │ Step 2A. 뉴스 감성 배치 분석 (HF Inference API, 동시성 8 제한)             │
 * │ Step 2B. Hybrid Stacking Ensemble 분석 (감성 covariate 주입, 동시성 6)     │
 * │ Step 3.  리스크 조정 스코어 계산 후 상위 30 선정                            │
 * │   ① 리스크 조정  = return30d / atr_pct × diversity × (1+감성틸트)         │
 * │   ② 초과수익 필터 = (return30d − 시장기준선) < 0 종목 자동 탈락           │
 * │   ③ 섹터 캡      = 동일 섹터 최대 5개 (쏠림 방지)                          │
 * │ Step 4.  Supabase upsert                                                    │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * 인증: Authorization: Bearer <CRON_SECRET>
 */

import { NextRequest, NextResponse } from "next/server";
import { prophetForecast } from "@/lib/server/prophet-forecast";
import { getQuote } from "@/lib/server/yahoo-finance";
import { supabase } from "@/lib/server/supabase";
import { STOCK_UNIVERSE, MIN_MARKET_CAP_KRW } from "@/lib/server/stock-universe";
import type { StaticCovariates } from "@/lib/server/prophet-forecast";
import { newsSentimentService } from "@/lib/server/news-sentiment";
import { mapWithConcurrency, withTimeout } from "@/lib/server/async-pool";

export const dynamic    = "force-dynamic";

// maxDuration: 뉴스 크롤링 + HF 추론(종목당 ~1.5s)이 추가되어 60s로는 빠듯하다.
// Vercel Pro/Enterprise(상한 300s) 기준으로 여유 있게 설정한다.
// ⚠ Hobby 플랜은 60s 상한이므로, 그 경우 뉴스 감성을 별도 크론으로 분리해
//   news_sentiment 테이블을 선(先) 적재하고 이 크론은 캐시만 읽도록 운용할 것.
export const maxDuration = 300;

const PER_TICKER_TIMEOUT_MS = 12_000;

/** 뉴스 감성 배치의 동시 실행 상한 (Naver/HF rate-limit 회피) */
const SENTIMENT_CONCURRENCY = 8;

/** 앙상블 분석의 동시 실행 상한 (Supabase/Naver 폴백 부하 제어) */
const FORECAST_CONCURRENCY = 6;

/**
 * 뉴스 감성 → 리스크 조정 스코어 틸트(tilt) 가중치.
 * 최종 점수에 (1 + sentiment_3d_ma × 0.15)를 곱한다.
 * 감성은 이미 TFT 어텐션 바이어스를 통해 return30d에 1차 반영되므로,
 * 여기서는 동률(tie) 종목 간 미세 우선순위 조정용으로만 0.15로 약하게 적용.
 */
const SENTIMENT_SCORE_TILT = 0.15;

/**
 * 섹터별 최대 포함 종목 수.
 * 반도체·2차전지 등 특정 섹터가 Top 30을 독점하는 쏠림(concentration risk) 방지.
 * 예: 반도체 4종 모두 상위권이어도 최대 5개까지만 포함.
 */
const SECTOR_MAX_COUNT = 5;

/**
 * 복합 수익률 가중치
 *   - TFT 30일 예측:        0.6 — 어텐션 기반 중기 패턴 방향성
 *   - LinearTrend 5일 예측: 0.4 — 단기 선형 모멘텀 (LightGBM 프록시)
 *
 * TFT가 중기 패턴 매칭, Linear가 단기 모멘텀 포착으로 역할 분리.
 * diversity_score로 모델 간 상관관계 패널티 추가.
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

  // ── Step 2A: 뉴스 감성 배치 분석 (동시성 제어로 Naver/HF 차단 회피) ─────────
  // 각 종목의 헤드라인을 크롤링해 Hugging Face Inference API로 호재/악재 분류.
  // 실패 종목은 중립(0)으로 graceful degrade → 메인 파이프라인 비중단.
  const sentimentMap = await newsSentimentService.getSentimentBatch(
    candidates.map(c => c.ticker),
    SENTIMENT_CONCURRENCY,
    runDate,
  );
  const sentimentOkCount = Array.from(sentimentMap.values()).filter(s => s.ok).length;
  console.log(`[cron] 뉴스 감성: ${sentimentOkCount}/${candidates.length}종목 분석 성공`);

  // ── Step 2B: 하이브리드 스태킹 앙상블 분석 (섹터 + 감성 covariate 주입) ──────
  // mapWithConcurrency로 동시 실행을 FORECAST_CONCURRENCY로 제한하고,
  // withTimeout으로 종목당 하드 타임아웃을 걸어 단일 종목 지연이 전체를 잡지 않게 함.
  const settled = await mapWithConcurrency(
    candidates,
    FORECAST_CONCURRENCY,
    ({ ticker, name, sector }) => {
      const sent = sentimentMap.get(ticker);
      const cov: StaticCovariates = {
        sector,
        sentimentScore: sent?.sentimentScore,
        sentiment3dMa:  sent?.sentiment3dMa,
      };
      return withTimeout(
        prophetForecast(ticker, cov).then(r => ({ ...r, stock_name: name })),
        PER_TICKER_TIMEOUT_MS,
        ticker,
      );
    },
  );

  type ForecastRow = Awaited<ReturnType<typeof prophetForecast>> & {
    stock_name:             string;
    sector:                 string;
    sentiment_score:        number;
    sentiment_3d_ma:        number;
    composite_return:       number;
    excess_return:          number;
    risk_adjusted_score:    number;
  };

  // ── Step 3-A: 리스크 조정 스코어 계산 ────────────────────────────────────
  //
  // ┌ 공식 ───────────────────────────────────────────────────────────────────┐
  // │                                                                         │
  // │  risk_adjusted_score                                                    │
  // │    = (return30d / atr_pct)            ← 핵심: 변동성 대비 수익 효율      │
  // │      × diversity_score                ← 모델 상관관계 패널티 [0.88,1.0] │
  // │      × (1 + sentiment_3d_ma × 0.15)   ← 뉴스 감성 미세 틸트 [0.85,1.15] │
  // │                                                                         │
  // │  • return30d = Ridge 메타 모델의 최종 30일 예측 수익률(%)               │
  // │    (TFT 단일 모델이 아닌, 4개 베이스 모델을 스태킹한 최종 산출값)        │
  // │  • atr_pct  = ATR(14) 기반 변동성(%) — 분모. 작을수록 점수↑ (Sharpe형)  │
  // │    내부 클램핑 ATR_PCT_FLOOR=0.5%로 0 division·과대 점수 방지            │
  // │  • 단순 return30d 정렬 대신 변동성으로 나눠, "적게 흔들리며 오르는"      │
  // │    종목을 상위로 끌어올린다(위험조정수익률 최적화).                      │
  // └─────────────────────────────────────────────────────────────────────────┘
  //
  // composite_return(0.6·tft30 + 0.4·linear5)은 대시보드 호환용 참고 지표로
  // 계속 산출하되, 정렬 기준은 위 risk_adjusted_score로 전환한다.

  interface ScoredCandidate extends Omit<ForecastRow, "excess_return" | "risk_adjusted_score"> {
    expected_return_30d: number;
  }

  // 1차 패스: 유효 예측만 수집 (감성·복합지표 포함)
  const valid: ScoredCandidate[] = [];
  settled.forEach((r, i) => {
    if (r.status !== "fulfilled") return;

    const f = r.value;
    if (f.insufficient_data || f.current_price <= 0 || !isFinite(f.predicted_return_30d)) return;

    const sent = sentimentMap.get(candidates[i].ticker);
    const composite_return = WEIGHT_30D * f.tft_return_30d + WEIGHT_5D * f.linear_return_5d;

    valid.push({
      ...f,
      stock_name:          candidates[i].name,
      sector:              candidates[i].sector,
      sentiment_score:     sent?.sentimentScore ?? 0,
      sentiment_3d_ma:     sent?.sentiment3dMa  ?? 0,
      composite_return,
      expected_return_30d: f.predicted_return_30d,
    });
  });

  // ── 시장 기준선(market baseline) ─────────────────────────────────────────
  // 후보군의 30일 예측 수익률 중앙값(median)을 "시장 기대수익률"의 횡단면 프록시로
  // 사용한다. 단, 약세장(중앙값<0)에서는 0으로 하한을 둬, 상대적으로 덜 빠지는
  // 종목이라도 절대 낙폭(음수)이면 진입하지 않도록 한다(자본 보존 우선).
  const sortedRet = valid.map(v => v.expected_return_30d).sort((a, b) => a - b);
  const median =
    sortedRet.length === 0 ? 0
    : sortedRet.length % 2 === 1 ? sortedRet[(sortedRet.length - 1) / 2]
    : (sortedRet[sortedRet.length / 2 - 1] + sortedRet[sortedRet.length / 2]) / 2;
  const marketBaseline = Math.max(0, median);

  // 2차 패스: 초과수익률 산출 → 음수(시장 이하 낙폭) 자동 탈락 → 리스크 조정 스코어
  const scored: ForecastRow[] = [];
  let droppedByExcess = 0;

  for (const v of valid) {
    // 기대 초과수익률 = 종목 예측수익률 − 시장 기준선
    const excess_return = v.expected_return_30d - marketBaseline;

    // 초과수익률이 음수면(시장 이하·낙폭) 진입 후보에서 제외
    if (excess_return < 0) { droppedByExcess++; continue; }

    // 뉴스 감성 틸트: [-1,+1] → [0.85, 1.15] 승수
    const sentimentTilt = 1 + Math.max(-1, Math.min(1, v.sentiment_3d_ma)) * SENTIMENT_SCORE_TILT;

    // 핵심 리스크 조정 스코어: 변동성 대비 수익 효율 × 다양성 × 감성
    const risk_adjusted_score =
      (v.expected_return_30d / v.atr_pct) * v.diversity_score * sentimentTilt;

    scored.push({ ...v, excess_return, risk_adjusted_score });
  }

  console.log(
    `[cron] 시장 기준선(median≥0)=${marketBaseline.toFixed(2)}% | ` +
    `초과수익 음수 탈락: ${droppedByExcess}종목`,
  );

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
    // 신규 컬럼: 복합 스코어 + 리스크 지표 + 뉴스 감성
    composite_return:     r.composite_return,
    risk_adjusted_score:  r.risk_adjusted_score,
    excess_return:        r.excess_return,
    atr_pct:              r.atr_pct,
    sentiment_score:      r.sentiment_score,
    sentiment_3d_ma:      r.sentiment_3d_ma,
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
    tft_return_30d:       +r.tft_return_30d.toFixed(2),
    linear_return_5d:     +r.linear_return_5d.toFixed(2),
    predicted_return_30d: +r.predicted_return_30d.toFixed(2),
    excess_return:        +r.excess_return.toFixed(2),
    atr_pct:              +r.atr_pct.toFixed(2),
    diversity_score:      +r.diversity_score.toFixed(3),
    sentiment_3d_ma:      +r.sentiment_3d_ma.toFixed(3),
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
