/**
 * PositionManagerService — ATR 기반 변동성 적응형 포지션 관리 엔진
 *
 * 헤지펀드 수준의 룰 베이스(Rule-Based) + 추세 추종(Trend Following) 원칙:
 *   ① ATR% 계산 → 종목별 변동성을 수치화
 *   ② 동적 StrategyConfig 생성 → 모든 임계값을 변동성에 비례하여 자동 조정
 *   ③ 세금·수수료를 반영한 Net PnL 기준으로 손절/익절 판단
 *   ④ 1주 보유 덫(1-Share Trap) 방어
 *   ⑤ 거래량 급증(Volume Breakout) 확인 후 피라미딩 허용
 *
 * 이 파일은 순수 함수(Pure Function) 형태로 작성되었으며,
 * 외부 API / 데이터베이스 / 파일 시스템 의존성이 전혀 없다.
 * 모든 데이터는 호출 측(API Route)에서 계산 후 주입(Dependency Injection)한다.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// § 1. 모델 파라미터 상수 (Named Constants — 하드코딩 수치 없음)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * ATR 계산 윈도우 (거래일 수)
 * Wilder의 원조 정의와 업계 표준을 따라 14일로 설정.
 * 14거래일 ≈ 약 3주 = 단기 변동성의 통계적 대표 구간.
 */
const ATR_PERIOD = 14;

/**
 * ATR 승수 — 손절(Stop-Loss)
 * stopLossPct = -ATR_MULT_STOP_LOSS × ATR%
 * "2 ATR 손절"은 월스트리트에서 가장 널리 쓰이는 표준.
 * 1 ATR은 정상적인 시장 노이즈의 범위이므로,
 * 2 ATR 하락 = 노이즈를 벗어난 통계적으로 유의미한 하락.
 */
const ATR_MULT_STOP_LOSS = 2;

/**
 * ATR 승수 — 트레일링 스탑(Trailing Stop)
 * trailingStopPct = -ATR_MULT_TRAILING × ATR%
 * 고점에서 2.5 ATR 하락 = 상승 추세의 일반적 되돌림(retracement)을
 * 초과한 추세 전환 신호. 손절보다 0.5 ATR 넓게 설정하는 이유:
 * 수익 구간에서는 조정이 더 크게 발생해도 추세가 유효할 수 있기 때문.
 */
const ATR_MULT_TRAILING = 2.5;

/**
 * ATR 승수 — 익절(Take-Profit)
 * takeProfitPct = +ATR_MULT_TAKE_PROFIT × ATR%
 * 리스크 대 리워드(R:R) 비율 = 3 ATR 수익 : 2 ATR 손실 = 1.5:1
 * 헤지펀드 최소 기준인 1:1.5 R:R을 충족.
 */
const ATR_MULT_TAKE_PROFIT = 3;

/**
 * ATR 승수 — 피라미딩(Pyramiding, 불타기)
 * pyramidingPct = +ATR_MULT_PYRAMIDING × ATR%
 * 1 ATR 수익 = 추세 방향이 확인되었으나 아직 과열 전 구간.
 * 이 지점에서 추가 매수해야 평단가 상승이 최소화됨.
 */
const ATR_MULT_PYRAMIDING = 1;

/**
 * ATR% 하한 클램핑 (%)
 * 초저변동성 종목(국채·우선주 등)에서 ATR%가 0.1% 수준으로 나오면
 * stopLoss가 -0.2%가 되어 장중 노이즈에도 즉시 발동되는 문제 방지.
 * 한국 대형 KOSPI 우량주의 최소 일평균 변동폭 ≈ 0.5%.
 */
const ATR_PCT_FLOOR = 0.5;

/**
 * ATR% 상한 클램핑 (%)
 * 초고변동성 종목(코스닥 소형주·테마주)에서 ATR%가 15% 이상 나오면
 * stopLoss가 -30%가 되어 사실상 손절 불가 포지션이 되는 문제 방지.
 * 합리적 리스크 관리 가능한 최대 변동성 상한선.
 */
const ATR_PCT_CEIL = 12.0;

/**
 * 매도 총 비용률 (증권거래세 + 수수료, 소수 표기)
 *   - 증권거래세: KOSPI 0.20%, KOSDAQ 0.20%  (2025년 기준)
 *   - 증권사 매도 수수료: 약 0.05% (온라인 기준)
 *   - 합계: 0.25% = 0.0025
 * 매수 시에는 거래세가 없으므로 Net PnL 계산은 매도 비용만 반영.
 */
const SELL_COST_RATE = 0.0025;

/**
 * RSI 과매수 기준 (과열 익절 판단)
 * RSI ≥ 75 = 시장 참가자의 75%가 수익 구간에 있음.
 * 통상 RSI 70이 과매수 기준이나, 75를 사용하여 강한 추세를 더 타도록 설계.
 */
const RSI_OVERBOUGHT = 75;

/**
 * 피라미딩 허용을 위한 거래량 급증 기준 (오늘 거래량 / 5일 평균 거래량)
 * 1.5배 이상 = 평소보다 50% 이상 거래량 증가.
 * → 기관·외국인 등 대형 플레이어의 본격 유입 가능성을 시사.
 * → 거래량 없는 추세는 신뢰할 수 없음("Volume is the gas in the tank").
 */
const VOLUME_BREAKOUT_RATIO = 1.5;

// ═══════════════════════════════════════════════════════════════════════════════
// § 2. 타입 정의
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * OHLCVCandle — ATR 계산에 필요한 OHLCV 캔들 1개의 데이터 구조
 *
 * 주의: TR(True Range) 계산에는 이전 캔들의 close가 필요하므로
 *       recentCandles 배열은 반드시 시간순(오래된 것 → 최신)으로 전달해야 함.
 */
export interface OHLCVCandle {
  high:   number;   // 고가 (원)
  low:    number;   // 저가 (원)
  close:  number;   // 종가 (원) — 전일 close로서 다음 TR 계산에 사용됨
  volume: number;   // 거래량 (주)
}

/**
 * StrategyConfig — ATR 기반으로 동적 생성되는 종목별 매매 임계값
 *
 * 모든 %값은 부호 포함 (음수 = 손실/하락, 양수 = 수익/상승).
 */
export interface StrategyConfig {
  /** ATR 절대값 (원) */
  atr:              number;
  /** ATR / CurrentPrice × 100 (%) — 변동성의 정규화 표현 */
  atr_pct:          number;
  /** 손절 발동 기준 수익률 (음수, e.g. -3.2) */
  stop_loss_pct:    number;
  /** 트레일링 스탑 발동 기준 하락률 (음수, e.g. -4.0) */
  trailing_stop_pct: number;
  /** 익절 발동 기준 수익률 (양수, e.g. +4.8) */
  take_profit_pct:  number;
  /** 피라미딩 발동 기준 수익률 (양수, e.g. +1.6) */
  pyramiding_pct:   number;
}

/**
 * PositionInput — PositionManagerService.analyze()의 입력 데이터 구조체
 *
 * 모든 필드는 호출 측(API Route)이 계산해서 주입(DI)한다.
 * 이 서비스 자체는 어떤 외부 IO도 수행하지 않는다.
 */
export interface PositionInput {
  /** 종목 코드 (예: "005930") */
  ticker:         string;
  /** 종목명 (예: "삼성전자") */
  name:           string;
  /** 현재 보유 수량 (주, 정수) */
  quantity:       number;
  /** 평균 매수가 (원) */
  avgPrice:       number;
  /** 현재 시장가 (원) — 실시간 또는 직전 거래일 종가 */
  currentPrice:   number;
  /** 매수 이후 달성한 최고가 (원) — 트레일링 스탑 기준점 */
  peakPrice:      number;
  /**
   * ATR 계산용 최근 캔들 배열 (시간순, 최소 15개 권장)
   * 14-기간 ATR에는 14개의 TR값이 필요 → TR[i]는 candle[i]와 candle[i-1]이 필요
   * → 14 TR값을 얻으려면 최소 15개 캔들이 필요
   */
  recentCandles:  OHLCVCandle[];
  /** RSI 14일 기준 (0~100, null이면 데이터 부족) */
  rsi:            number | null;
  /** 현재 거래일의 5일 이동평균 (원, null이면 계산 불가) */
  ma5Now:         number | null;
  /** 전일의 5일 이동평균 (원, null이면 기울기 판단 불가) */
  ma5Prev:        number | null;
  /** 오늘 거래량 (주, null이면 거래량 분석 불가) */
  volumeToday:    number | null;
  /** 5일 평균 거래량 (주, null이면 비율 계산 불가) */
  volumeMa5:      number | null;
  /** 이미 피라미딩 실행 여부 — true이면 추가 매수 불가 (1회 제한) */
  pyramidingDone: boolean;
}

/**
 * OrderAction — analyze()의 반환 타입
 *
 * meta 필드에는 수식 검증을 위한 중간 계산값이 모두 포함되어 있다.
 * UI에서 "왜 이 결정이 났는지" 사용자에게 투명하게 설명할 수 있다.
 */
export interface OrderAction {
  /** 주문 유형 */
  type:     "SELL" | "BUY" | "HOLD";
  /** 주문 수량 (주). HOLD이면 0. */
  quantity: number;
  /** 한국어 판단 근거 (UI 표시용, 수식 포함) */
  reason:   string;
  meta: {
    /** 세전(Gross) 수익률: (현재가 - 평단가) / 평단가 × 100 */
    gross_pnl_pct:         number;
    /** 세후(Net) 수익률: 세금·수수료 차감 후 실질 손익률 */
    net_pnl_pct:           number;
    /** 매도 비용률 (%) — 증권거래세 + 수수료 합산 */
    sell_cost_pct:         number;
    /** 고점 대비 하락률 (%): (현재가 - 고점) / 고점 × 100 */
    trailing_drop_pct:     number;
    /** 오늘 거래량 / 5일 평균 거래량 (null이면 계산 불가) */
    volume_ratio:          number | null;
    /** ATR 기반 동적 임계값 설정값 전체 */
    config:                StrategyConfig;
    /** 손절 발동 기준가 (원): avgPrice × (1 + stopLossPct/100) */
    stop_loss_price:       number;
    /** 트레일링 스탑 발동 기준가 (원): peakPrice × (1 + trailingStopPct/100) */
    trailing_stop_price:   number;
    /** 피라미딩 발동 기준가 (원): avgPrice × (1 + pyramidingPct/100) */
    pyramid_trigger_price: number;
    /**
     * 주문 수량 — 1주 보유 덫(1-Share Trap) 보정 후
     * Math.max(1, Math.floor(quantity × 0.5))
     */
    half_qty:              number;
  };
}

/** API가 반환하는 1개 종목의 전체 분석 결과 */
export interface PositionAnalysisResult {
  position_id:     number;
  ticker:          string;
  name:            string;
  quantity:        number;
  avg_price:       number;
  current_price:   number;
  peak_price:      number;
  gross_pnl_pct:   number;
  net_pnl_pct:     number;
  rsi:             number | null;
  ma5:             number | null;
  volume_ratio:    number | null;
  atr_pct:         number;
  pyramiding_done: boolean;
  action:          OrderAction;
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 3. VolatilityCalculator — ATR 계산기
// ═══════════════════════════════════════════════════════════════════════════════

export class VolatilityCalculator {
  /**
   * compute — OHLCV 캔들 배열로부터 ATR(14)를 계산하고
   *           종목별 동적 StrategyConfig를 생성한다.
   *
   * ┌ ATR(Average True Range) 계산 공식 ────────────────────────────────────┐
   * │                                                                        │
   * │  True Range[i] = max(                                                  │
   * │    High[i]  - Low[i],          ← 당일 고저폭 (intraday range)         │
   * │    |High[i] - Close[i-1]|,     ← 전일 종가 기준 상방 갭               │
   * │    |Low[i]  - Close[i-1]|      ← 전일 종가 기준 하방 갭               │
   * │  )                                                                     │
   * │                                                                        │
   * │  → 세 값 중 최댓값 = 시장이 하루 동안 실제로 움직인 최대 범위         │
   * │  → 갭 상승/하락이 있을 때 단순 고저폭보다 더 정확히 변동성을 포착     │
   * │                                                                        │
   * │  ATR(14) = SMA(True Range, 14)  ← 최근 14개 TR의 단순 평균           │
   * │                                                                        │
   * │  ATR% = ATR(14) / CurrentPrice × 100                                  │
   * │  → 주가 수준에 무관한 정규화된 변동성 지표                            │
   * │  → 예: ATR=3,000원, 현재가=100,000원 → ATR%=3.0%                      │
   * │                                                                        │
   * └────────────────────────────────────────────────────────────────────────┘
   *
   * @param candles      시간순(오래된 것 → 최신) OHLCV 캔들 배열 (최소 15개 권장)
   * @param currentPrice 현재 시장가 (ATR% 분모로 사용)
   * @returns            { atr, atrPct, config } — atrPct는 클램핑 적용 후 값
   */
  static compute(
    candles:      OHLCVCandle[],
    currentPrice: number,
  ): { atr: number; atrPct: number; config: StrategyConfig } {
    // ─ 엣지 케이스 방어: 캔들이 2개 미만이면 TR 계산 자체가 불가 ──────────
    // 캔들이 없거나 1개면 TR = High - Low만 계산 가능 (갭 정보 없음).
    // 이 경우 ATR%를 FLOOR 값으로 설정하여 최소 보수적 임계값을 보장한다.
    if (candles.length < 2 || currentPrice <= 0) {
      const fallbackAtrPct = ATR_PCT_FLOOR;
      return {
        atr:    currentPrice * (fallbackAtrPct / 100),
        atrPct: fallbackAtrPct,
        config: VolatilityCalculator._buildConfig(fallbackAtrPct, currentPrice * (fallbackAtrPct / 100), currentPrice),
      };
    }

    // ─ True Range 계산 ────────────────────────────────────────────────────
    // candles[i].close = 전일 종가로서 candles[i+1]의 TR 계산에 사용됨.
    // i=0은 이전 캔들이 없으므로 스킵 → i=1부터 시작.
    const trueRanges: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const { high, low }   = candles[i];
      const prevClose       = candles[i - 1].close;

      /**
       * TR[i] = max(당일 고저폭, 전일대비 고가 갭, 전일대비 저가 갭)
       *
       * 수식 예시 (갭 상승 케이스):
       *   전일 종가: 10,000원
       *   당일 고가: 10,800원, 당일 저가: 10,200원
       *   ① High - Low         = 10,800 - 10,200 = 600원
       *   ② |High - PrevClose| = |10,800 - 10,000| = 800원  ← 최대 → TR = 800원
       *   ③ |Low  - PrevClose| = |10,200 - 10,000| = 200원
       */
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low  - prevClose),
      );
      trueRanges.push(tr);
    }

    // ─ ATR(14) = 최근 14개 TR의 단순 평균 ─────────────────────────────────
    // 캔들이 15개 미만이면 가용한 TR 전체를 사용 (단, 최소 1개 보장됨).
    const window = Math.min(ATR_PERIOD, trueRanges.length);
    const recentTR = trueRanges.slice(-window);
    const atr = recentTR.reduce((sum, v) => sum + v, 0) / recentTR.length;

    // ─ ATR% 계산 및 클램핑 ────────────────────────────────────────────────
    /**
     * ATR% = ATR / CurrentPrice × 100
     *
     * 클램핑 이유:
     *   ① ATR_PCT_FLOOR (0.5%): 초저변동성 종목 보호.
     *      국채 ETF 등에서 ATR%=0.05%가 나오면 stopLoss = -0.1%가 되어
     *      장중 호가 스프레드만으로도 즉시 손절 발동 → 불합리.
     *
     *   ② ATR_PCT_CEIL (12.0%): 초고변동성 종목 보호.
     *      테마주·급등주에서 ATR%=20%가 나오면 stopLoss = -40%가 되어
     *      사실상 "손절 없음"과 동일 → 리스크 관리 파탄.
     */
    const rawAtrPct = currentPrice > 0 ? (atr / currentPrice) * 100 : ATR_PCT_FLOOR;
    const atrPct    = Math.min(ATR_PCT_CEIL, Math.max(ATR_PCT_FLOOR, rawAtrPct));

    return {
      atr,
      atrPct,
      config: VolatilityCalculator._buildConfig(atrPct, atr, currentPrice),
    };
  }

  /** ATR%로부터 StrategyConfig를 생성하는 내부 헬퍼 */
  private static _buildConfig(
    atrPct:       number,
    atr:          number,
    currentPrice: number,
  ): StrategyConfig {
    return {
      atr,
      atr_pct:           Math.round(atrPct * 100) / 100,
      /**
       * stopLossPct = -(ATR_MULT_STOP_LOSS × ATR%)
       * 예: ATR%=3% → stopLoss = -(2 × 3) = -6%
       * → 평단가에서 6% 하락 시 손절 발동
       */
      stop_loss_pct:     -(ATR_MULT_STOP_LOSS    * atrPct),
      /**
       * trailingStopPct = -(ATR_MULT_TRAILING × ATR%)
       * 예: ATR%=3% → trailing = -(2.5 × 3) = -7.5%
       * → 고점에서 7.5% 하락 시 트레일링 스탑 발동
       */
      trailing_stop_pct: -(ATR_MULT_TRAILING     * atrPct),
      /**
       * takeProfitPct = +(ATR_MULT_TAKE_PROFIT × ATR%)
       * 예: ATR%=3% → takeProfit = +(3 × 3) = +9%
       * R:R 비율 = 9% 수익 : 6% 손실 = 1.5:1 (헤지펀드 최소 기준 충족)
       */
      take_profit_pct:   +(ATR_MULT_TAKE_PROFIT  * atrPct),
      /**
       * pyramidingPct = +(ATR_MULT_PYRAMIDING × ATR%)
       * 예: ATR%=3% → pyramiding = +(1 × 3) = +3%
       * → 평단가에서 3% 상승 시 추가 매수 조건 충족
       */
      pyramiding_pct:    +(ATR_MULT_PYRAMIDING   * atrPct),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 4. PositionManagerService — 매매 의사결정 엔진
// ═══════════════════════════════════════════════════════════════════════════════

export class PositionManagerService {
  /**
   * analyze — 단일 포지션에 대한 ATR 기반 매매 판단 및 주문 수량 산출
   *
   * ┌ 판단 우선순위 (Priority Queue) ────────────────────────────────────────┐
   * │ 1순위: 손절(Stop-Loss)           — Net PnL ≤ stopLossPct → 전량 매도  │
   * │ 2순위: 트레일링 스탑             — 고점 대비 ≤ trailingStopPct → 전량 │
   * │ 3순위: 과열 익절(Take-Profit)    — Net PnL ≥ takeProfitPct & RSI ≥ 75 │
   * │ 4순위: 피라미딩(Pyramiding)      — Net PnL ≥ pyramidingPct & MA5 & 거래량 │
   * │ 5순위: 보유 유지(HOLD)           — 그 외 모든 경우                    │
   * └────────────────────────────────────────────────────────────────────────┘
   */
  static analyze(input: PositionInput): OrderAction {
    const {
      quantity, avgPrice, currentPrice, peakPrice,
      recentCandles, rsi, ma5Now, ma5Prev,
      volumeToday, volumeMa5, pyramidingDone,
    } = input;

    // ── § 4-A. ATR 계산 및 동적 StrategyConfig 생성 ───────────────────────
    const { config } = VolatilityCalculator.compute(recentCandles, currentPrice);

    // ── § 4-B. 세전/세후 손익률 계산 ────────────────────────────────────────

    /**
     * 세전 수익률 (Gross PnL %)
     * 공식: (현재가 - 평단가) / 평단가 × 100
     *
     * 예시: 평단가 100,000원, 현재가 93,000원
     *   → (93,000 - 100,000) / 100,000 × 100 = -7.0%
     */
    const grossPnlPct = avgPrice > 0
      ? ((currentPrice - avgPrice) / avgPrice) * 100
      : 0;

    /**
     * 매도 실수령액 (세금·수수료 차감)
     * 공식: 현재가 × (1 - SELL_COST_RATE)
     *       = 현재가 × (1 - 0.0025)
     *
     * 예시: 현재가 100,000원 → 실수령 = 99,750원
     *   (증권거래세 200원 + 수수료 50원 = 250원 차감)
     *
     * 매도 비용은 '주당' 차감되므로 총 비용 = 현재가 × SELL_COST_RATE × 수량
     */
    const netProceeds = currentPrice * (1 - SELL_COST_RATE);

    /**
     * 세후 순수익률 (Net PnL %)
     * 공식: (실수령액 - 평단가) / 평단가 × 100
     *
     * 예시: 실수령 99,750원, 평단가 100,000원
     *   → (99,750 - 100,000) / 100,000 × 100 = -0.25%
     *   → 즉, 주가가 현재가와 동일하게 유지되어도 세후로는 -0.25% 손실
     *
     * 손절/익절 판단을 '세후 순수익률' 기준으로 하는 이유:
     *   - 세전 기준으로는 "+3%"로 보여도 실제 수령액은 "+2.75%"
     *   - 실질 손익을 기준으로 해야 정확한 리스크 관리 가능
     */
    const netPnlPct = avgPrice > 0
      ? ((netProceeds - avgPrice) / avgPrice) * 100
      : 0;

    // ── § 4-C. 고점 대비 하락률 계산 ─────────────────────────────────────────

    /**
     * 트레일링 드롭률 (Trailing Drop %)
     * 공식: (현재가 - 고점) / 고점 × 100  (항상 ≤ 0)
     *
     * 예시: 고점 150,000원, 현재가 138,000원
     *   → (138,000 - 150,000) / 150,000 × 100 = -8.0%
     *   → config.trailing_stop_pct가 -7.5%라면 트레일링 스탑 발동
     *
     * 엣지 케이스: peakPrice = 0 또는 미설정이면 0으로 처리 (트레일링 미발동)
     */
    const trailingDropPct = peakPrice > 0
      ? ((currentPrice - peakPrice) / peakPrice) * 100
      : 0;

    // ── § 4-D. 발동 기준가 계산 (원) ─────────────────────────────────────────

    /**
     * 손절 발동 기준가: avgPrice × (1 + config.stop_loss_pct / 100)
     * 예: 평단가 100,000원, stopLossPct=-6% → 발동가 = 94,000원
     */
    const stopLossPrice = avgPrice > 0
      ? avgPrice * (1 + config.stop_loss_pct / 100)
      : 0;

    /**
     * 트레일링 스탑 발동 기준가: peakPrice × (1 + config.trailing_stop_pct / 100)
     * 예: 고점 150,000원, trailingStopPct=-7.5% → 발동가 = 138,750원
     */
    const trailingStopPrice = peakPrice > 0
      ? peakPrice * (1 + config.trailing_stop_pct / 100)
      : 0;

    /**
     * 피라미딩 발동 기준가: avgPrice × (1 + config.pyramiding_pct / 100)
     * 예: 평단가 100,000원, pyramidingPct=+3% → 발동가 = 103,000원
     */
    const pyramidTriggerPrice = avgPrice > 0
      ? avgPrice * (1 + config.pyramiding_pct / 100)
      : 0;

    // ── § 4-E. 1주 보유 덫(1-Share Trap) 방어 로직 ────────────────────────

    /**
     * 50% 수량 계산 — Math.max(1, Math.floor(quantity × 0.5))
     *
     * ┌ 문제: 1주 보유 시 Math.floor(1 × 0.5) = Math.floor(0.5) = 0
     * │  → 분할 매도/추가 매수 수량이 0주 = 주문 불가 상태
     * │  → 익절 조건이 성립해도 "HOLD" 판정이 나는 버그
     * └
     *
     * ┌ 해결: Math.max(1, ...)로 최솟값 1주 보장
     * │  qty=1 → max(1, floor(0.5)) = max(1, 0) = 1  → 1주 전량 처리
     * │  qty=2 → max(1, floor(1.0)) = max(1, 1) = 1  → 1주 (50%)
     * │  qty=3 → max(1, floor(1.5)) = max(1, 1) = 1  → 1주 (33%)
     * │  qty=7 → max(1, floor(3.5)) = max(1, 3) = 3  → 3주 (43%)
     * └
     *
     * 주의: qty=1인 익절/피라미딩은 전량 처리(100%)가 되므로,
     *       reason 문자열에 "(1주 전량)" 명시하여 사용자에게 알림.
     */
    const halfQty = Math.max(1, Math.floor(quantity * 0.5));
    const isOneShareTrap = quantity === 1;

    // ── § 4-F. 거래량 급증(Volume Breakout) 판별 ─────────────────────────

    /**
     * 거래량 비율: volumeToday / volumeMa5
     * 피라미딩 조건의 필수 확인 항목.
     *
     * null 처리:
     *   - volumeToday 또는 volumeMa5가 null이면 비율 계산 불가
     *   - isVolumeBreakout = false (보수적 판단 — 데이터 없으면 피라미딩 미허용)
     *   - 장중에는 당일 거래량이 확정되지 않으므로 과소 측정될 수 있음
     *
     * 엣지 케이스: volumeMa5 = 0 → 0으로 나누기 방지
     */
    const volumeRatio =
      volumeToday !== null && volumeMa5 !== null && volumeMa5 > 0
        ? Math.round((volumeToday / volumeMa5) * 100) / 100
        : null;
    const isVolumeBreakout = volumeRatio !== null && volumeRatio >= VOLUME_BREAKOUT_RATIO;

    /** 공통 meta 객체 — 모든 케이스에서 재사용 */
    const meta: OrderAction["meta"] = {
      gross_pnl_pct:         Math.round(grossPnlPct * 100) / 100,
      net_pnl_pct:           Math.round(netPnlPct   * 100) / 100,
      sell_cost_pct:         SELL_COST_RATE * 100,
      trailing_drop_pct:     Math.round(trailingDropPct * 100) / 100,
      volume_ratio:          volumeRatio,
      config,
      stop_loss_price:       Math.round(stopLossPrice),
      trailing_stop_price:   Math.round(trailingStopPrice),
      pyramid_trigger_price: Math.round(pyramidTriggerPrice),
      half_qty:              halfQty,
    };

    // ══════════════════════════════════════════════════════════════════════════
    // 1순위: 손절 (Stop-Loss)
    // ══════════════════════════════════════════════════════════════════════════
    /**
     * 조건: 세후 순수익률(netPnlPct) ≤ ATR 기반 손절 기준(config.stop_loss_pct)
     *
     * 세후 기준을 사용하는 이유:
     *   "지금 팔면 실제로 얼마를 받는가"를 정확히 반영하기 위해.
     *   세전 -6%라도 세후로는 -6.25%가 될 수 있음.
     *
     * 물타기(Averaging Down) 절대 금지:
     *   하락 추세에서의 추가 매수 = 잘못된 방향에 자본을 추가 투입.
     *   월스트리트 격언: "Don't throw good money after bad."
     *
     * 수량: 전량(100%) 매도
     */
    if (netPnlPct <= config.stop_loss_pct) {
      return {
        type:     "SELL",
        quantity,
        reason:
          `[손절] 세후 수익률 ${netPnlPct.toFixed(2)}% ≤ ${config.stop_loss_pct.toFixed(2)}%` +
          ` (2×ATR ${config.atr_pct.toFixed(2)}%) — ` +
          `전량 ${quantity}주 매도 | 손절가 ${stopLossPrice.toLocaleString()}원 | 세전 ${grossPnlPct.toFixed(2)}%`,
        meta,
      };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 2순위: 트레일링 스탑 (Trailing Stop)
    // ══════════════════════════════════════════════════════════════════════════
    /**
     * 조건: 고점(peakPrice) 대비 하락률(trailingDropPct) ≤ config.trailing_stop_pct
     *
     * 트레일링 스탑 vs 손절의 차이:
     *   손절   = 평단가 기준 하방 방어 (원금 보호)
     *   트레일링 = 달성한 고점 기준 하방 방어 (확보된 수익 보호)
     *
     * 예시: 평단가 100,000원, 고점 150,000원 (수익 50%),
     *       trailing_stop_pct = -7.5% (ATR%=3%)
     *       → 트레일링 발동가 = 150,000 × 0.925 = 138,750원
     *       → 현재가 138,000원이면 트레일링 발동 → 전량 매도
     *       → 여전히 138% 수익 확보 (손절 없이 수익 보호)
     *
     * 수량: 전량(100%) 매도 (추세가 꺾인 것으로 판단)
     */
    /**
     * 트레일링 스탑 추가 조건: grossPnlPct >= 0 (수익 구간 진입 필수)
     *
     * 트레일링 스탑의 목적 = "달성된 수익 보호". 포지션이 매수가 아래(손실)일 때
     * 트레일링 스탑을 발동하는 것은 설계 의도와 어긋난다:
     *   - 손실 구간 보호 → 손절(Stop-Loss)의 역할
     *   - 수익 구간 보호 → 트레일링 스탑의 역할
     *
     * 이 조건이 없으면 "매수 전 고점이 90일 lookback에 포함될 때"
     * 포지션이 수익이 없음에도 트레일링 스탑이 손절보다 먼저 발동되는 오발동 발생.
     * grossPnlPct >= 0 이면 수익 구간이므로 트레일링 스탑 발동 허용.
     */
    if (peakPrice > 0 && trailingDropPct <= config.trailing_stop_pct && grossPnlPct >= 0) {
      return {
        type:     "SELL",
        quantity,
        reason:
          `[트레일링 스탑] 고점 ${peakPrice.toLocaleString()}원 대비 ` +
          `${trailingDropPct.toFixed(2)}% 하락 (기준 ${config.trailing_stop_pct.toFixed(2)}%` +
          ` = 2.5×ATR ${config.atr_pct.toFixed(2)}%) — ` +
          `전량 ${quantity}주 매도 | 발동가 ${trailingStopPrice.toLocaleString()}원`,
        meta,
      };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 3순위: 과열 익절 — 분할 매도 (Take-Profit)
    // ══════════════════════════════════════════════════════════════════════════
    /**
     * 조건: 세후 순수익률 ≥ takeProfitPct AND RSI ≥ 75(과매수)
     *
     * 두 조건이 동시에 필요한 이유:
     *   ① takeProfitPct만 충족: 수익 났지만 추세 가속 중일 수 있음 → 홀딩 유리
     *   ② RSI만 과열: 조정 위험이 있지만 수익이 목표에 못 미침 → 홀딩 유리
     *   ③ 둘 다 충족: 수익 실현 + 과매수 동시 = 분할 매도 타이밍
     *
     * 1주 보유 덫 처리:
     *   quantity=1 → halfQty=max(1,0)=1 → 1주 전량 매도 (50%가 1주이므로 동일)
     *   → reason에 "(1주 전량)" 명시
     *
     * 수량: Math.max(1, Math.floor(quantity × 0.5))
     *   → 나머지 (quantity - halfQty)주는 추세 연장 또는 트레일링에 위임
     */
    if (netPnlPct >= config.take_profit_pct && rsi !== null && rsi >= RSI_OVERBOUGHT) {
      const remaining = quantity - halfQty;
      return {
        type:     "SELL",
        quantity: halfQty,
        reason:
          `[익절·분할] 세후 +${netPnlPct.toFixed(2)}% ≥ +${config.take_profit_pct.toFixed(2)}%` +
          ` (3×ATR ${config.atr_pct.toFixed(2)}%) & RSI ${rsi.toFixed(1)} ≥ ${RSI_OVERBOUGHT} — ` +
          `${halfQty}주 매도${isOneShareTrap ? " (1주 전량)" : ` (50%, 잔여 ${remaining}주 홀딩`})`,
        meta,
      };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 4순위: 피라미딩 — 추가 매수 (Pyramiding)
    // ══════════════════════════════════════════════════════════════════════════
    /**
     * 조건 (4가지 모두 충족):
     *   ① !pyramidingDone              — 1회 제한 미소진
     *   ② netPnlPct ≥ pyramidingPct    — ATR 1배 이상 수익 중
     *   ③ MA5 상승 추세                — 단기 모멘텀 확인
     *   ④ Volume Breakout              — 거래량 급증으로 추세 강도 확인
     *
     * MA5 상승 추세 판별 (2가지 조건 모두):
     *   ① currentPrice > ma5Now: 현재가 > MA5 (가격이 단기 평균선 위)
     *   ② ma5Now > ma5Prev:      MA5 기울기 양(+) (평균선 자체가 우상향)
     *   → 둘 다 true = 단기 추세가 상승 중이며 가속화 중
     *
     * 거래량 급증(Volume Breakout):
     *   volumeToday / volumeMa5 ≥ 1.5
     *   → 평소보다 50% 이상 거래량 = 대형 플레이어 참여 신호
     *   → 거래량 없는 상승은 "쉽게 무너질 가짜 추세"일 가능성
     *
     * 1주 보유 덫 처리:
     *   quantity=1 → halfQty=1 → 1주 추가 매수 (총 2주로 100% 증량)
     *   → 피라미딩 원칙(50% 추가)과 유사한 효과
     *
     * 수량: Math.max(1, Math.floor(quantity × 0.5)) 주 추가 매수
     */
    const ma5Uptrend =
      ma5Now !== null && ma5Prev !== null &&
      currentPrice > ma5Now &&   // ①: 현재가 > MA5 (단기 상승 추세)
      ma5Now > ma5Prev;           // ②: MA5 기울기 상승 (모멘텀 강화)

    if (!pyramidingDone && netPnlPct >= config.pyramiding_pct && ma5Uptrend && isVolumeBreakout) {
      return {
        type:     "BUY",
        quantity: halfQty,
        reason:
          `[피라미딩] 세후 +${netPnlPct.toFixed(2)}% ≥ +${config.pyramiding_pct.toFixed(2)}%` +
          ` (1×ATR ${config.atr_pct.toFixed(2)}%) & MA5 상승 & 거래량 ${volumeRatio?.toFixed(2)}배 급증 — ` +
          `${halfQty}주 추가 매수${isOneShareTrap ? " (1주, 100% 증량)" : ` (현재 ${quantity}주의 50%, 1회 한정`})`,
        meta,
      };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 5순위: 보유 유지 (HOLD)
    // ══════════════════════════════════════════════════════════════════════════
    /**
     * 위 4가지 조건에 해당하지 않는 모든 경우.
     * 감정적 개입 방지: 명확한 신호 없이는 반드시 홀딩.
     * "시장에서 가장 어려운 일은 아무것도 하지 않는 것이다." — Jesse Livermore
     */
    return {
      type:     "HOLD",
      quantity: 0,
      reason:   "추세 지속 — 매매 조건 미충족, 보유 유지",
      meta,
    };
  }
}
