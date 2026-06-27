/**
 * EntryPointAnalysis — 규칙 기반 기술적 진입타점 산출
 * ============================================================================
 * 미래 가격 "예측"이 아니라, 과거 가격에서 도출한 기술적 레벨(지지선·이동평균·
 * 밴드)을 계산해 "어디서 분할매수하면 되는지"의 참고 구간을 제시한다.
 * pullback-analysis(눌림목 4단계)를 신호 보강에 재사용한다.
 *
 * ※ 정보 제공용 정량 신호이며 개인 투자자문/매매 권유가 아니다.
 */

import type { CandleData } from "./yahoo-finance";
import { analyzePullback, type PullbackResult } from "./pullback-analysis";

function sma(arr: number[], w: number): number | null {
  if (arr.length < w) return null;
  return arr.slice(arr.length - w).reduce((a, b) => a + b, 0) / w;
}

function stddev(arr: number[], w: number): number | null {
  if (arr.length < w) return null;
  const slice = arr.slice(arr.length - w);
  const m = slice.reduce((a, b) => a + b, 0) / w;
  const v = slice.reduce((a, b) => a + (b - m) ** 2, 0) / w;
  return Math.sqrt(v);
}

export type EntryState = "buy_zone" | "watch" | "overbought" | "weak";

export interface EntryPointResult {
  ticker:        string;
  currentPrice:  number;
  ma20:          number | null;
  ma60:          number | null;
  rsi:           number | null;
  /** 1차 지지(주로 20일선) */
  supportPrimary:   number | null;
  /** 2차 지지(스윙 저점/60일선 중 낮은 값) */
  supportSecondary: number | null;
  /** 볼린저 하단(20,2σ) — 과매도성 분할매수 참고 */
  bollingerLower:   number | null;
  /** 권장 분할매수 밴드(하단~상단) */
  entryLow:      number | null;
  entryHigh:     number | null;
  /** 손절 참고선(2차 지지 -3%) */
  stopLoss:      number | null;
  /** 현재가가 진입 밴드 대비 어디인지 */
  state:         EntryState;
  pullbackSignal: PullbackResult["signal"];
  pullbackScore:  number;
  note:          string;
  insufficient_data: boolean;
}

export function analyzeEntryPoint(ticker: string, candles: CandleData[]): EntryPointResult {
  const empty = (): EntryPointResult => ({
    ticker, currentPrice: 0, ma20: null, ma60: null, rsi: null,
    supportPrimary: null, supportSecondary: null, bollingerLower: null,
    entryLow: null, entryHigh: null, stopLoss: null,
    state: "weak", pullbackSignal: "none", pullbackScore: 0,
    note: "데이터 부족", insufficient_data: true,
  });

  if (!candles || candles.length < 30) return empty();

  const closes = candles.map((c) => c.close);
  const lows   = candles.map((c) => c.low);
  const price  = closes[closes.length - 1];

  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);
  const sd20 = stddev(closes, 20);
  const bollingerLower = ma20 != null && sd20 != null ? ma20 - 2 * sd20 : null;

  // 최근 20거래일 스윙 저점
  const swingLow = Math.min(...lows.slice(Math.max(0, lows.length - 20)));

  // 눌림목 분석 재사용(신호·RSI)
  const pb = analyzePullback(ticker, candles);
  const rsi = pb.rsi;

  // 지지선: 현재가 아래의 가장 가까운 기술적 레벨을 1차, 그 아래를 2차로.
  const candidates = [ma20, ma60, swingLow, bollingerLower]
    .filter((v): v is number => v != null && v > 0 && v <= price)
    .sort((a, b) => b - a);                         // 현재가에 가까운(높은) 순
  const supportPrimary   = candidates[0] ?? (ma20 ?? null);
  const supportSecondary = candidates[1] ?? (ma60 != null && ma60 < (supportPrimary ?? Infinity) ? ma60 : swingLow);

  // 권장 분할매수 밴드: 1차 지지 ~ 2차 지지(없으면 1차의 -3%)
  const entryHigh = supportPrimary;
  const entryLow  = supportSecondary != null && supportSecondary < (supportPrimary ?? Infinity)
    ? supportSecondary
    : supportPrimary != null ? Math.round(supportPrimary * 0.97) : null;

  const stopBase  = supportSecondary ?? supportPrimary;
  const stopLoss  = stopBase != null ? Math.round(stopBase * 0.97) : null;

  // 상태 판정
  const distToPrimaryPct = supportPrimary != null ? ((price - supportPrimary) / supportPrimary) * 100 : null;
  let state: EntryState;
  if (rsi != null && rsi >= 75) {
    state = "overbought";                           // 과열 — 추격 자제
  } else if (entryLow != null && entryHigh != null && price >= entryLow * 0.99 && price <= entryHigh * 1.02) {
    state = "buy_zone";                             // 권장 밴드 근처 — 분할매수 구간
  } else if (ma20 != null && price > ma20 && (distToPrimaryPct == null || distToPrimaryPct <= 8)) {
    state = "watch";                                // 추세 위 but 밴드 위 — 눌림 대기
  } else {
    state = "weak";                                 // 추세 이탈/지지 하회
  }

  const note = (() => {
    switch (state) {
      case "buy_zone":   return `현재가가 1차 지지(${entryHigh?.toLocaleString()}원) 부근 — 분할매수 참고 구간`;
      case "watch":      return `추세 상단 — 1차 지지 ${entryHigh?.toLocaleString()}원까지 눌림 시 분할매수 검토`;
      case "overbought": return `RSI ${rsi?.toFixed(0)} 과열 — 추격 자제, 눌림 대기 권장`;
      default:           return `추세 약화/지지 하회 — 진입 보류, 손절선 ${stopLoss?.toLocaleString()}원 참고`;
    }
  })();

  return {
    ticker,
    currentPrice: price,
    ma20, ma60, rsi,
    supportPrimary, supportSecondary, bollingerLower,
    entryLow, entryHigh, stopLoss,
    state,
    pullbackSignal: pb.signal,
    pullbackScore:  pb.score,
    note,
    insufficient_data: false,
  };
}
