/**
 * GET /api/portfolio/[id]/position-analysis
 *
 * 포트폴리오에 등록된 종목 각각에 대해 PositionManagerService를 적용하여
 * 손절 / 익절(분할·트레일링) / 피라미딩 판단 결과와 정확한 주문 수량을 반환한다.
 *
 * 데이터 수집 흐름:
 *   1. portfolios + positions 조회 (소유권 검증)
 *   2. 각 종목의 1년치 차트 데이터 병렬 조회
 *   3. calcSignals()로 RSI 추출 / calcIndicators()로 MA5 계산
 *   4. 최근 90 거래일 최고가를 peak_price로 산정
 *   5. position.notes에 "[pyramided]" 포함 여부로 피라미딩 1회 제한 플래그 확인
 *   6. PositionManagerService.analyze() 호출 → OrderAction 반환
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase }                  from "@/lib/server/supabase";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getChart }                  from "@/lib/server/yahoo-finance";
import { getQuote }                  from "@/lib/server/yahoo-finance";
import { calcSignals, calcIndicators } from "@/lib/server/indicators";
import {
  PositionManagerService,
  type PositionAnalysisResult,
} from "@/lib/server/position-manager-service";

export const dynamic     = "force-dynamic";
export const maxDuration = 45;  // 종목당 차트 조회 병렬화 → 최대 10~15s 소요 예상

type Ctx = { params: Promise<{ id: string }> };

/** 최근 N 거래일 고가를 peak_price로 사용 */
const PEAK_LOOKBACK_DAYS = 90;

/** 피라미딩 완료 플래그 — position.notes 필드에 이 문자열이 있으면 이미 실행됨 */
const PYRAMIDING_DONE_FLAG = "[pyramided]";

export async function GET(req: NextRequest, { params }: Ctx) {
  // ── 인증 ──────────────────────────────────────────────────────────────────
  const [serverClient, { id }] = await Promise.all([
    createSupabaseServerClient(),
    params,
  ]);
  const { data: { user } } = await serverClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  // ── 포트폴리오 소유권 검증 + 포지션 조회 ────────────────────────────────
  const [{ data: pf }, { data: positions }] = await Promise.all([
    supabase
      .from("portfolios")
      .select("id, name")
      .eq("id", id)
      .eq("user_id", user.id)
      .single(),
    supabase
      .from("positions")
      .select("id, ticker, name, quantity, avg_price, notes")
      .eq("portfolio_id", id),
  ]);

  if (!pf)
    return NextResponse.json({ error: "포트폴리오를 찾을 수 없습니다." }, { status: 404 });

  if (!positions?.length)
    return NextResponse.json({ results: [] });

  // ── 종목별 차트 + 현재가 병렬 조회 ─────────────────────────────────────
  // 1년치 일봉(getChart "1y") + 현재가(getQuote)를 동시에 가져와 API 호출 횟수를 최소화
  const [chartResults, quoteResults] = await Promise.all([
    Promise.allSettled(positions.map((p) => getChart(p.ticker, "1y"))),
    Promise.allSettled(positions.map((p) => getQuote(p.ticker))),
  ]);

  // ── 종목별 분석 ───────────────────────────────────────────────────────────
  const results: PositionAnalysisResult[] = positions.map((pos, i) => {
    // ─ 차트 데이터 추출 ───────────────────────────────────────────────────
    const chartResult = chartResults[i];
    const candles =
      chartResult.status === "fulfilled" && chartResult.value.length >= 30
        ? chartResult.value
        : [];

    // ─ 현재가 결정 ───────────────────────────────────────────────────────
    // Yahoo Finance에서 가져온 현재가 우선, 실패 시 차트 최신 종가, 그것도 없으면 평단가
    const quoteResult = quoteResults[i];
    const quotePrice =
      quoteResult.status === "fulfilled" && quoteResult.value?.price
        ? quoteResult.value.price
        : null;
    const lastCandleClose = candles.length > 0
      ? candles[candles.length - 1].close
      : null;
    const currentPrice = quotePrice ?? lastCandleClose ?? pos.avg_price;

    // ─ RSI 및 MA 지표 계산 ───────────────────────────────────────────────
    let rsi:      number | null = null;
    let ma5Now:   number | null = null;
    let ma5Prev:  number | null = null;
    let closePrev: number | null = null;

    if (candles.length >= 30) {
      // RSI 14일: calcSignals()의 rsi 필드
      const signals = calcSignals(candles);
      rsi = typeof signals.rsi === "number" ? signals.rsi : null;

      // MA5 전체 시리즈: calcIndicators()의 ma5 Series
      //   시리즈의 마지막 값 = 현재 MA5
      //   시리즈의 마지막-1 값 = 전일 MA5 (기울기 판단용)
      const indicators = calcIndicators(candles);
      const ma5Series  = indicators.ma5 ?? [];
      const len        = ma5Series.length;

      if (len >= 2) {
        ma5Now  = ma5Series[len - 1].value;   // 현재 MA5
        ma5Prev = ma5Series[len - 2].value;   // 전일 MA5 (기울기 판단)
      } else if (len === 1) {
        ma5Now = ma5Series[0].value;
      }

      // 전일 종가: candles의 뒤에서 두 번째
      if (candles.length >= 2) {
        closePrev = candles[candles.length - 2].close;
      }
    }

    // ─ Peak Price(최고가) 산정 ────────────────────────────────────────────
    // 최근 PEAK_LOOKBACK_DAYS(90) 거래일의 고가(High) 중 최댓값을 peak_price로 사용
    // 보유 기간을 정확히 알 수 없으므로 90일 고가를 합리적 대리값으로 활용
    //   → 90일 기준이 실제 보유 기간보다 짧으면 고점이 낮게 산정되어 더 보수적인 결정 유도
    let peakPrice = currentPrice; // 기본값: 현재가 (고점 데이터 없으면 트레일링 스탑 미작동)
    if (candles.length > 0) {
      const tail = candles.slice(-PEAK_LOOKBACK_DAYS);
      // candle.high가 있으면 고가 기준, 없으면 close 기준
      peakPrice = Math.max(...tail.map((c) => c.high ?? c.close));
    }

    // ─ 피라미딩 1회 제한 플래그 확인 ─────────────────────────────────────
    // position.notes 필드에 "[pyramided]" 문자열이 있으면 이미 실행된 것으로 간주
    const pyramidingDone = (pos.notes ?? "").includes(PYRAMIDING_DONE_FLAG);

    // ─ PositionManagerService 호출 ───────────────────────────────────────
    const action = PositionManagerService.analyze({
      ticker:         pos.ticker,
      name:           pos.name,
      quantity:       pos.quantity,
      avgPrice:       pos.avg_price,
      currentPrice,
      peakPrice,
      rsi,
      ma5Now,
      ma5Prev,
      closePrev,
      pyramidingDone,
    });

    // ─ 현재 수익률 (UI 직접 표시용) ─────────────────────────────────────
    const pnlPct =
      pos.avg_price > 0
        ? ((currentPrice - pos.avg_price) / pos.avg_price) * 100
        : 0;

    return {
      position_id:     pos.id,
      ticker:          pos.ticker,
      name:            pos.name,
      quantity:        pos.quantity,
      avg_price:       pos.avg_price,
      current_price:   currentPrice,
      peak_price:      Math.round(peakPrice),
      pnl_pct:         Math.round(pnlPct * 100) / 100,
      rsi,
      ma5:             ma5Now,
      pyramiding_done: pyramidingDone,
      action,
    };
  });

  return NextResponse.json({ results });
}
