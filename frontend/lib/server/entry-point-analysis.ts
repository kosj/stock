/**
 * EntryPointAnalysis — 규칙 기반 기술적 진입타점·손절 산출 (ATR 적응형)
 * ============================================================================
 * 미래 가격 "예측"이 아니라, 과거 가격에서 도출한 기술적 레벨(지지선·이동평균·
 * 밴드)과 변동성(ATR)으로 진입/손절/익절 구간을 계산한다.
 *
 * v2 개선 — 점검에서 드러난 결함 교정:
 *   1. [손절] 기존에는 지지선 × 0.97(고정 -3%)이었다. 변동성을 무시하므로
 *      채권 ETF(ATR≈0.3%)는 노이즈만으로 손절되고, 레버리지 ETF(ATR≈5%)는
 *      손절이 사실상 작동하지 않았다. → 이미 저장소에 있던 ATR 엔진
 *      (VolatilityCalculator, 2 ATR 손절 표준)을 사용하도록 교체.
 *   2. [손익비] R/R(리스크 대비 보상) 계산이 없어 "진입할 가치"를 판단할 수
 *      없었다. → 익절 목표(3 ATR)와 R/R을 산출해 함께 제공.
 *   3. [트레일링] 보유 중 이익 보호 기준이 없었다. → 샹들리에 방식
 *      (최근 고점 - 2.5 ATR) 추가.
 *   4. [ETF 부적합] 눌림목(analyzePullback)은 개별주 기준봉(거래량 300%↑,
 *      일간 +7%↑ 장대양봉)을 전제한다. ETF는 바스켓이라 이 조건이 거의
 *      성립하지 않아 점수가 구조적으로 0에 수렴 → ETF에서는 참고 지표로만
 *      쓰고, 적용 가능 여부(pullbackApplicable)를 명시한다.
 *
 * ※ 정보 제공용 정량 신호이며 개인 투자자문/매매 권유가 아니다.
 */

import type { CandleData } from "./yahoo-finance";
import { analyzePullback, type PullbackResult } from "./pullback-analysis";
import { VolatilityCalculator } from "./position-manager-service";

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

  /** 1차 지지(현재가 바로 아래 기술적 레벨) */
  supportPrimary:   number | null;
  /** 2차 지지(그 아래 레벨) */
  supportSecondary: number | null;
  /** 볼린저 하단(20,2σ) */
  bollingerLower:   number | null;

  /** 권장 분할매수 밴드 */
  entryLow:      number | null;
  entryHigh:     number | null;

  // ── ATR 기반 리스크 관리 ──────────────────────────────────────────────
  /** ATR 절대값(원) */
  atr:           number | null;
  /** ATR / 현재가 × 100 (%) — 정규화 변동성 */
  atrPct:        number | null;
  /** 손절선 — 구조적 지지 아래 ATR 버퍼 적용 */
  stopLoss:      number | null;
  /** 손절폭(%) — 진입 기준가 대비 */
  stopLossPct:   number | null;
  /** 익절 목표(3 ATR) */
  takeProfit:    number | null;
  /** 트레일링 스탑(최근 고점 - 2.5 ATR, 샹들리에) */
  trailingStop:  number | null;
  /** 손익비 = (목표-진입) / (진입-손절). 2 이상이면 양호 */
  riskReward:    number | null;

  state:         EntryState;

  /** 눌림목 분석 적용 가능 여부 — ETF 등 바스켓 상품은 false */
  pullbackApplicable: boolean;
  pullbackSignal: PullbackResult["signal"];
  pullbackScore:  number;

  note:          string;
  insufficient_data: boolean;
}

export interface EntryPointOptions {
  /**
   * ETF 등 바스켓 상품 여부. true면 눌림목(개별주 기준봉 전제) 점수를
   * 판정에 반영하지 않고 참고값으로만 노출한다.
   */
  isBasket?: boolean;
}

export function analyzeEntryPoint(
  ticker: string,
  candles: CandleData[],
  opts: EntryPointOptions = {},
): EntryPointResult {
  const empty = (): EntryPointResult => ({
    ticker, currentPrice: 0, ma20: null, ma60: null, rsi: null,
    supportPrimary: null, supportSecondary: null, bollingerLower: null,
    entryLow: null, entryHigh: null,
    atr: null, atrPct: null, stopLoss: null, stopLossPct: null,
    takeProfit: null, trailingStop: null, riskReward: null,
    state: "weak", pullbackApplicable: false, pullbackSignal: "none", pullbackScore: 0,
    note: "데이터 부족", insufficient_data: true,
  });

  if (!candles || candles.length < 30) return empty();

  const closes = candles.map((c) => c.close);
  const highs  = candles.map((c) => c.high);
  const lows   = candles.map((c) => c.low);
  const price  = closes[closes.length - 1];
  if (!price || price <= 0) return empty();

  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);
  const sd20 = stddev(closes, 20);
  const bollingerLower = ma20 != null && sd20 != null ? ma20 - 2 * sd20 : null;

  // 최근 20거래일 스윙 저점/고점
  const recentLows  = lows.slice(Math.max(0, lows.length - 20));
  const recentHighs = highs.slice(Math.max(0, highs.length - 20));
  const swingLow  = Math.min(...recentLows);
  const swingHigh = Math.max(...recentHighs);

  // ── ATR: 저장소의 검증된 엔진 재사용(2 ATR 손절, ATR% 0.5~12% 클램핑) ──
  const { atr, atrPct, config } = VolatilityCalculator.compute(
    candles.map((c) => ({ high: c.high, low: c.low, close: c.close, volume: c.volume })),
    price,
  );

  const pb = analyzePullback(ticker, candles);
  const rsi = pb.rsi;
  // ETF/바스켓은 개별주 기준봉 전제가 성립하지 않아 판정에서 제외
  const pullbackApplicable = !opts.isBasket;

  // ── 지지선 정렬: 현재가 아래에서 가까운 순 ──────────────────────────────
  const candidates = [ma20, ma60, swingLow, bollingerLower]
    .filter((v): v is number => v != null && v > 0 && v <= price)
    .sort((a, b) => b - a);
  const supportPrimary   = candidates[0] ?? ma20 ?? null;
  const supportSecondary = candidates[1]
    ?? (ma60 != null && ma60 < (supportPrimary ?? Infinity) ? ma60 : swingLow);

  // ── 분할매수 밴드: 1차 지지 ~ 2차 지지(없으면 1차 - 1 ATR) ─────────────
  const entryHigh = supportPrimary;
  const entryLow  =
    supportSecondary != null && supportSecondary < (supportPrimary ?? Infinity)
      ? supportSecondary
      : supportPrimary != null ? Math.round(supportPrimary - atr) : null;

  // 진입 기준가 = 밴드 중앙(리스크 계산 기준)
  const entryMid =
    entryLow != null && entryHigh != null ? (entryLow + entryHigh) / 2 : price;

  // ── 손절: 구조적 지지 아래로 1 ATR 버퍼 vs 2 ATR 손절 중 더 보수적인 값 ─
  // 지지선 바로 밑에 두면 일상적 노이즈에 털리므로 ATR 버퍼를 준다.
  const structuralStop = (supportSecondary ?? supportPrimary ?? price) - atr;
  const atrStop        = entryMid * (1 + config.stop_loss_pct / 100); // stop_loss_pct는 음수
  const stopLoss       = Math.round(Math.min(structuralStop, atrStop));
  const stopLossPct    = entryMid > 0
    ? Math.round(((stopLoss - entryMid) / entryMid) * 10000) / 100
    : null;

  // ── 익절 목표: 3 ATR. 단, 최근 스윙 고점이 더 가까우면 그쪽을 우선 ──────
  const atrTarget  = entryMid * (1 + config.take_profit_pct / 100);
  const takeProfit = Math.round(
    swingHigh > entryMid ? Math.min(atrTarget, swingHigh) : atrTarget,
  );

  // ── 트레일링 스탑(샹들리에): 최근 20일 고점 - 2.5 ATR ──────────────────
  const trailingStop = Math.round(swingHigh + (swingHigh * config.trailing_stop_pct) / 100);

  // ── 손익비 ─────────────────────────────────────────────────────────────
  const riskAmt   = entryMid - stopLoss;
  const rewardAmt = takeProfit - entryMid;
  const riskReward = riskAmt > 0 ? Math.round((rewardAmt / riskAmt) * 100) / 100 : null;

  // ── 상태 판정 ──────────────────────────────────────────────────────────
  const distToPrimaryPct =
    supportPrimary != null ? ((price - supportPrimary) / supportPrimary) * 100 : null;

  let state: EntryState;
  if (rsi != null && rsi >= 75) {
    state = "overbought";
  } else if (
    entryLow != null && entryHigh != null &&
    price >= entryLow - atr * 0.5 && price <= entryHigh + atr * 0.5
  ) {
    // 밴드 근접 판정도 고정 %가 아니라 ATR 기준(변동성 적응)
    state = "buy_zone";
  } else if (ma20 != null && price > ma20 && (distToPrimaryPct == null || distToPrimaryPct <= 8)) {
    state = "watch";
  } else {
    state = "weak";
  }

  const won = (v: number | null) => (v != null ? v.toLocaleString() + "원" : "—");
  const note = (() => {
    const rr = riskReward != null ? ` | 손익비 ${riskReward.toFixed(1)}:1` : "";
    const vol = ` | ATR ${atrPct.toFixed(1)}%`;
    switch (state) {
      case "buy_zone":
        return `현재가가 1차 지지(${won(entryHigh)}) 부근 — 분할매수 참고 구간. `
             + `손절 ${won(stopLoss)}(${stopLossPct?.toFixed(1)}%)${rr}${vol}`;
      case "watch":
        return `추세 상단 — ${won(entryHigh)}까지 눌림 시 분할매수 검토. `
             + `손절 ${won(stopLoss)}${rr}${vol}`;
      case "overbought":
        return `RSI ${rsi?.toFixed(0)} 과열 — 추격 자제, 눌림 대기 권장${vol}`;
      default:
        return `추세 약화/지지 하회 — 진입 보류. 보유 시 손절 ${won(stopLoss)} 참고${vol}`;
    }
  })();

  return {
    ticker,
    currentPrice: price,
    ma20, ma60, rsi,
    supportPrimary, supportSecondary, bollingerLower,
    entryLow, entryHigh,
    atr: Math.round(atr), atrPct: Math.round(atrPct * 100) / 100,
    stopLoss, stopLossPct, takeProfit, trailingStop, riskReward,
    state,
    pullbackApplicable,
    pullbackSignal: pullbackApplicable ? pb.signal : "none",
    pullbackScore:  pullbackApplicable ? pb.score : 0,
    note,
    insufficient_data: false,
  };
}
