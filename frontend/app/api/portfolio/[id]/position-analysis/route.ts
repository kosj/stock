/**
 * GET /api/portfolio/[id]/position-analysis
 *
 * 포트폴리오 포지션별 ATR 기반 매매 판단:
 *   1. portfolios + positions 조회 (소유권 검증)
 *   2. 1년치 차트 + 현재가 병렬 조회
 *   3. ATR(14) 계산용 recentCandles(마지막 15개), volumeToday, volumeMa5 추출
 *   4. calcSignals()로 RSI / calcIndicators()로 MA5·Vol MA5 계산
 *   5. 최근 90 거래일 고가 → peak_price
 *   6. PositionManagerService.analyze() 호출 → OrderAction 반환
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase }                  from "@/lib/server/supabase";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getChart, getQuote }        from "@/lib/server/yahoo-finance";
import { calcSignals, calcIndicators } from "@/lib/server/indicators";
import {
  PositionManagerService,
  type OHLCVCandle,
  type PositionAnalysisResult,
} from "@/lib/server/position-manager-service";

export const dynamic     = "force-dynamic";
export const maxDuration = 45;

type Ctx = { params: Promise<{ id: string }> };

/** 최근 N 거래일의 고가 max를 peak_price로 사용 */
const PEAK_LOOKBACK_DAYS = 90;

/**
 * ATR(14) 계산에 필요한 최소 캔들 수
 * TR[i] = candle[i] + candle[i-1] → 14개 TR값을 위해 15개 캔들 필요
 */
const ATR_CANDLE_COUNT = 15;

/** 피라미딩 완료 플래그 */
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
    const quoteResult = quoteResults[i];
    const quotePrice =
      quoteResult.status === "fulfilled" && quoteResult.value?.price
        ? quoteResult.value.price
        : null;
    const lastCandleClose = candles.length > 0
      ? candles[candles.length - 1].close
      : null;
    const currentPrice = quotePrice ?? lastCandleClose ?? pos.avg_price;

    // ─ RSI 및 MA5·볼륨 MA5 지표 계산 ───────────────────────────────────
    let rsi:       number | null = null;
    let ma5Now:    number | null = null;
    let ma5Prev:   number | null = null;
    let volumeMa5: number | null = null;

    if (candles.length >= 30) {
      const signals    = calcSignals(candles);
      rsi = typeof signals.rsi === "number" ? signals.rsi : null;

      const indicators = calcIndicators(candles);

      // MA5 시리즈: 마지막 = 오늘, 마지막-1 = 전일 (기울기 판단)
      const ma5Series = indicators.ma5 ?? [];
      const ma5Len    = ma5Series.length;
      if (ma5Len >= 2) {
        ma5Now  = ma5Series[ma5Len - 1].value;
        ma5Prev = ma5Series[ma5Len - 2].value;
      } else if (ma5Len === 1) {
        ma5Now = ma5Series[0].value;
      }

      // 5일 평균 거래량: vol_ma5 시리즈의 마지막 값
      const volMa5Series = indicators.vol_ma5 ?? [];
      if (volMa5Series.length > 0) {
        volumeMa5 = volMa5Series[volMa5Series.length - 1].value;
      }
    }

    // ─ ATR 계산용 최근 캔들 추출 ─────────────────────────────────────────
    // ATR(14)에는 14개 TR값 → 15개 캔들 필요 (TR[i]는 candle[i], candle[i-1] 사용)
    // candle에 high/low/volume이 없는 경우를 방어 (Yahoo Finance 응답 불안정)
    const recentCandles: OHLCVCandle[] = candles
      .slice(-ATR_CANDLE_COUNT)
      .map((c) => ({
        high:   c.high   ?? c.close,  // high 누락 시 close로 대체
        low:    c.low    ?? c.close,  // low  누락 시 close로 대체
        close:  c.close,
        volume: c.volume ?? 0,        // volume 누락 시 0으로 대체
      }));

    // ─ 오늘 거래량 추출 ───────────────────────────────────────────────────
    // 마지막 캔들의 volume = 가장 최근 거래일의 거래량
    // 장중에는 당일 거래량이 확정되지 않으므로 과소 측정될 수 있음
    const volumeToday: number | null =
      candles.length > 0 && (candles[candles.length - 1].volume ?? 0) > 0
        ? candles[candles.length - 1].volume
        : null;

    // ─ Peak Price(최고가) 산정 ────────────────────────────────────────────
    let peakPrice = currentPrice;
    if (candles.length > 0) {
      const tail = candles.slice(-PEAK_LOOKBACK_DAYS);
      peakPrice = Math.max(...tail.map((c) => c.high ?? c.close));
    }

    // ─ 피라미딩 1회 제한 플래그 확인 ─────────────────────────────────────
    const pyramidingDone = (pos.notes ?? "").includes(PYRAMIDING_DONE_FLAG);

    // ─ PositionManagerService 호출 (ATR 기반 분석) ───────────────────────
    const action = PositionManagerService.analyze({
      ticker:         pos.ticker,
      name:           pos.name,
      quantity:       pos.quantity,
      avgPrice:       pos.avg_price,
      currentPrice,
      peakPrice,
      recentCandles,
      rsi,
      ma5Now,
      ma5Prev,
      volumeToday,
      volumeMa5,
      pyramidingDone,
    });

    return {
      position_id:     pos.id,
      ticker:          pos.ticker,
      name:            pos.name,
      quantity:        pos.quantity,
      avg_price:       pos.avg_price,
      current_price:   currentPrice,
      peak_price:      Math.round(peakPrice),
      // UI 직접 표시: action.meta에서 가져옴 (세전/세후 모두 포함)
      gross_pnl_pct:   action.meta.gross_pnl_pct,
      net_pnl_pct:     action.meta.net_pnl_pct,
      rsi,
      ma5:             ma5Now,
      volume_ratio:    action.meta.volume_ratio,
      atr_pct:         action.meta.config.atr_pct,
      pyramiding_done: pyramidingDone,
      action,
    } satisfies PositionAnalysisResult;
  });

  return NextResponse.json({ results });
}
