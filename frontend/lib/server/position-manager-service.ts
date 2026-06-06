/**
 * PositionManagerService — 포지션별 매매 의사결정 엔진
 *
 * 감정을 철저히 배제하고 룰 베이스(Rule-Based) + 추세 추종(Trend Following) 원칙으로
 * 손절 / 익절(분할·트레일링) / 불타기(피라미딩) 여부와 정확한 주문 수량을 산출한다.
 *
 * 이 클래스는 순수 계산(Pure Computation) 서비스로, 외부 의존성이 전혀 없다.
 * 데이터 수집(차트, 현재가 등)은 호출 측(API Route)에서 담당한다.
 */

// ── 상수 ─────────────────────────────────────────────────────────────────────

/** 손절 기준: 평단가 대비 이 수치 이하로 하락하면 전량 매도 */
const STOP_LOSS_PCT = -7;

/** 익절(A) 기준 수익률: 이 수치 이상이고 RSI도 과열 구간이면 50% 분할 매도 */
const TAKE_PROFIT_PCT = 10;

/** 익절(A) RSI 과열 기준: RSI가 이 값 이상일 때 '과매수 = 추세 꺾임 위험' 으로 판단 */
const RSI_OVERBOUGHT = 75;

/** 트레일링 스탑 기준: 고점(Peak) 대비 이 수치 이하로 하락하면 전량 매도 */
const TRAILING_STOP_PCT = -8;

/** 피라미딩(불타기) 기준 수익률: 이 수치 이상이고 단기 추세도 강해야 추가 매수 허용 */
const PYRAMIDING_PCT = 5;

// ── 입력 타입 ─────────────────────────────────────────────────────────────────

/**
 * PositionInput — PositionManagerService.analyze()의 입력 데이터 구조체
 *
 * @param ticker          종목 코드 (예: "005930")
 * @param name            종목명 (예: "삼성전자")
 * @param quantity        현재 보유 수량 (주, 정수)
 * @param avgPrice        평균 매수가 (원)
 * @param currentPrice    현재 시장가 (원) — Yahoo Finance 또는 KIS API 기준
 * @param peakPrice       매수 이후 달성한 최고가 (원) — 트레일링 스탑 기준점
 * @param rsi             RSI 14일 기준 (0~100 범위, 없으면 null)
 * @param ma5Now          현재 거래일의 5일 이동평균 (원, 없으면 null)
 * @param ma5Prev         전일의 5일 이동평균 (원, 없으면 null) — MA5 기울기 판단용
 * @param closePrev       전일 종가 (원, 없으면 null) — MA5 위/아래 여부 판단용
 * @param pyramidingDone  이미 피라미딩 실행 여부 — true이면 추가 매수 불가 (1회 제한)
 */
export interface PositionInput {
  ticker:         string;
  name:           string;
  quantity:       number;
  avgPrice:       number;
  currentPrice:   number;
  peakPrice:      number;
  rsi:            number | null;
  ma5Now:         number | null;
  ma5Prev:        number | null;
  closePrev:      number | null;
  pyramidingDone: boolean;
}

// ── 출력 타입 ─────────────────────────────────────────────────────────────────

/**
 * OrderAction — analyze()의 반환 타입
 *
 * @param type      주문 유형: "SELL"(매도) | "BUY"(매수·피라미딩) | "HOLD"(보유 유지)
 * @param quantity  주문 수량 (주). HOLD이면 0.
 * @param reason    한국어 판단 근거 (UI 표시용)
 * @param meta      수량 산출 수식을 검증하기 위한 중간 계산값
 */
export interface OrderAction {
  type:     "SELL" | "BUY" | "HOLD";
  quantity: number;
  reason:   string;
  meta: {
    pnl_pct:                number;  // 현재 수익률 (%)
    trailing_drop_pct:      number;  // 고점 대비 하락률 (%)
    stop_loss_price:        number;  // 손절 발동 기준가 (원)
    trailing_stop_price:    number;  // 트레일링 스탑 발동 기준가 (원)
    pyramid_trigger_price:  number;  // 피라미딩 발동 기준가 (원)
    half_qty:               number;  // 50% 수량 (익절A 또는 피라미딩 계산용)
  };
}

// ── PositionAnalysisResult ────────────────────────────────────────────────────

/** API가 반환하는 1개 종목의 분석 결과 (input + action 포함) */
export interface PositionAnalysisResult {
  position_id:    number;
  ticker:         string;
  name:           string;
  quantity:       number;
  avg_price:      number;
  current_price:  number;
  peak_price:     number;
  pnl_pct:        number;
  rsi:            number | null;
  ma5:            number | null;
  pyramiding_done: boolean;
  action:         OrderAction;
}

// ── PositionManagerService ────────────────────────────────────────────────────

export class PositionManagerService {

  /**
   * analyze — 단일 포지션에 대한 매매 판단 및 주문 수량 산출
   *
   * ┌ 판단 우선순위 ──────────────────────────────────────────────┐
   * │ 1순위: 손절(Stop-Loss)        — 원금 보호 최우선            │
   * │ 2순위: 트레일링 스탑          — 확보된 수익 방어            │
   * │ 3순위: 과열 익절(Take-Profit) — RSI 과매수 구간 일부 실현   │
   * │ 4순위: 피라미딩(Pyramiding)   — 추세 확인 후 추가 매수      │
   * │ 5순위: HOLD                   — 그 외 모든 경우             │
   * └────────────────────────────────────────────────────────────┘
   */
  static analyze(input: PositionInput): OrderAction {
    const {
      quantity, avgPrice, currentPrice, peakPrice,
      rsi, ma5Now, ma5Prev, closePrev, pyramidingDone,
    } = input;

    // ── 공통 중간값 선계산 ─────────────────────────────────────────────────

    /**
     * 현재 수익률 (%)
     * 공식: (현재가 - 평단가) / 평단가 × 100
     * 예: 평단가 10,000원, 현재가 9,300원 → (9300-10000)/10000 × 100 = -7.0%
     */
    const pnlPct = ((currentPrice - avgPrice) / avgPrice) * 100;

    /**
     * 고점 대비 하락률 (%)
     * 공식: (현재가 - 고점) / 고점 × 100   (항상 0 이하)
     * 예: 고점 15,000원, 현재가 13,500원 → (13500-15000)/15000 × 100 = -10.0%
     * → 트레일링 스탑 기준 -8%를 초과했으므로 매도 신호
     */
    const trailingDropPct = peakPrice > 0
      ? ((currentPrice - peakPrice) / peakPrice) * 100
      : 0;

    /**
     * 손절 발동 기준가 (원) — 평단가의 (1 + STOP_LOSS_PCT/100)
     * 공식: avgPrice × (1 - 0.07)
     * 예: 평단가 10,000원 → 손절 발동가 = 9,300원
     */
    const stopLossPrice = avgPrice * (1 + STOP_LOSS_PCT / 100);

    /**
     * 트레일링 스탑 발동 기준가 (원) — 고점의 (1 + TRAILING_STOP_PCT/100)
     * 공식: peakPrice × (1 - 0.08)
     * 예: 고점 15,000원 → 트레일링 스탑 발동가 = 13,800원
     */
    const trailingStopPrice = peakPrice * (1 + TRAILING_STOP_PCT / 100);

    /**
     * 피라미딩 발동 기준가 (원) — 평단가의 (1 + PYRAMIDING_PCT/100)
     * 공식: avgPrice × (1 + 0.05)
     * 예: 평단가 10,000원 → 피라미딩 발동가 = 10,500원
     */
    const pyramidTriggerPrice = avgPrice * (1 + PYRAMIDING_PCT / 100);

    /**
     * 50% 수량 계산 (익절A 분할 매도 및 피라미딩 추가 매수 공용)
     * Math.floor()로 소수점 이하 버림 → 예수금 초과 방지 + 잔여 홀딩 수량 보장
     * 예: 보유 7주 → floor(7 × 0.5) = floor(3.5) = 3주
     */
    const halfQty = Math.floor(quantity * 0.5);

    /** 공통 meta 객체 — 모든 케이스에서 재사용 */
    const meta = {
      pnl_pct:               Math.round(pnlPct * 100) / 100,
      trailing_drop_pct:     Math.round(trailingDropPct * 100) / 100,
      stop_loss_price:       Math.round(stopLossPrice),
      trailing_stop_price:   Math.round(trailingStopPrice),
      pyramid_trigger_price: Math.round(pyramidTriggerPrice),
      half_qty:              halfQty,
    };

    // ── 1순위: 손절 (Stop-Loss) ────────────────────────────────────────────
    /**
     * 조건: 현재 수익률 ≤ -7%
     *   → 평단가 대비 7% 이상 하락 = 하락 추세가 통계적으로 유의미
     *   → 물타기는 절대 금지: 하락 추세에서의 추가 매수는 손실을 기하급수적으로 키움
     *   → "틀렸을 때는 즉각적으로, 확신 없이" 원칙 — 손실을 작게 끊는다
     *
     * 수량 산출: 전량(100%) 매도
     *   → quantity 주 전부 시장가 매도
     */
    if (pnlPct <= STOP_LOSS_PCT) {
      return {
        type:     "SELL",
        quantity,
        reason:
          `[손절] 수익률 ${pnlPct.toFixed(2)}% ≤ ${STOP_LOSS_PCT}% — ` +
          `전량 ${quantity}주 매도 (발동가 ${stopLossPrice.toLocaleString()}원)`,
        meta,
      };
    }

    // ── 2순위: 트레일링 스탑 (Trailing Stop) ─────────────────────────────
    /**
     * 조건: 매수 이후 최고가(peakPrice) 대비 -8% 이상 하락
     *   → 상승 추세가 유효했을 때 벌어둔 수익을 지키기 위한 '이동 방어선'
     *   → 고점 대비 -8%는 일반적인 조정(noise)을 넘어 추세 전환 신호로 해석
     *   → 수익 중이더라도 트레일링이 발동되면 전량 청산 (추세가 꺾였다고 판단)
     *
     * 수량 산출: 전량(100%) 매도
     *   → quantity 주 전부 시장가 매도
     */
    if (trailingDropPct <= TRAILING_STOP_PCT) {
      return {
        type:     "SELL",
        quantity,
        reason:
          `[트레일링 스탑] 고점 ${peakPrice.toLocaleString()}원 대비 ` +
          `${trailingDropPct.toFixed(2)}% 하락 (기준 ${TRAILING_STOP_PCT}%) — ` +
          `전량 ${quantity}주 매도 (발동가 ${trailingStopPrice.toLocaleString()}원)`,
        meta,
      };
    }

    // ── 3순위: 과열 익절 — 분할 매도 (Take-Profit A) ─────────────────────
    /**
     * 조건: 수익률 ≥ +10% AND RSI ≥ 75 (과매수)
     *   → 수익률이 목표에 도달하면서 동시에 RSI가 과매수 구간(75+)에 진입 =
     *     시장 참가자들이 이미 몰려있는 상태 → 단기 조정 가능성 높음
     *   → 하지만 추세가 여전히 살아있을 수 있으므로 '전량 청산'이 아닌 '50% 분할 매도'
     *   → 나머지 50%는 추세 연장 or 트레일링 스탑에 맡김
     *
     * 수량 산출: Math.floor(quantity × 0.5)
     *   → 소수점 버림으로 항상 정수 주문 보장
     *   → 예: 7주 보유 시 floor(7×0.5) = 3주 매도, 4주 홀딩
     *   → halfQty < 1이면 (1주 보유 등) 수량이 0이 되므로 HOLD 처리
     */
    if (pnlPct >= TAKE_PROFIT_PCT && rsi !== null && rsi >= RSI_OVERBOUGHT) {
      if (halfQty >= 1) {
        return {
          type:     "SELL",
          quantity: halfQty,
          reason:
            `[익절·분할] 수익률 +${pnlPct.toFixed(2)}% ≥ ${TAKE_PROFIT_PCT}% & ` +
            `RSI ${rsi.toFixed(1)} ≥ ${RSI_OVERBOUGHT} (과매수) — ` +
            `${halfQty}주 매도 (전체 ${quantity}주의 50%, 나머지 ${quantity - halfQty}주 홀딩)`,
          meta,
        };
      }
    }

    // ── 4순위: 피라미딩 — 추가 매수 (Pyramiding) ─────────────────────────
    /**
     * 조건: !pyramidingDone AND 수익률 ≥ +5% AND MA5 상승 추세 확인
     *
     * 피라미딩(Pyramiding): "승마에 채찍질하기" — 이미 수익 중인 종목에만 베팅을 늘리는 기법
     *   → 수익 중이면 해당 포지션의 방향성 예측이 맞았다는 증거
     *   → 단, 추세가 계속 유지되고 있는지 MA5로 재확인 필요
     *   → 무분별한 증량을 막기 위해 1회(pyramidingDone)로 제한
     *
     * MA5 상승 추세 확인 (두 가지 조건 모두 충족):
     *   ① currentPrice > ma5Now  : 현재가가 MA5 위에 있음 (단기 추세 = 상승)
     *   ② ma5Now > ma5Prev       : MA5 자체가 상향 중 (모멘텀 = 강화)
     *   → 두 조건 모두 true = "가격도 MA5 위, MA5도 기울기가 올라가는 중" = 강한 상승 추세
     *
     * 수량 산출: Math.floor(quantity × 0.5)
     *   → '현재 보유 수량의 50%'를 추가 매수
     *   → 비중이 1.5배로 늘어남 (예: 10주 보유 → 5주 추가 → 15주)
     *   → 수익 중에만 매수하므로 평단가 상승은 최소화됨
     *   → halfQty < 1이면 수량이 0이 되므로 HOLD 처리
     */
    const ma5Uptrend =
      ma5Now !== null &&
      ma5Prev !== null &&
      closePrev !== null &&
      currentPrice > ma5Now &&   // ①: 현재가가 MA5 위
      ma5Now > ma5Prev;           // ②: MA5가 기울기 상승 중

    if (!pyramidingDone && pnlPct >= PYRAMIDING_PCT && ma5Uptrend) {
      if (halfQty >= 1) {
        return {
          type:     "BUY",
          quantity: halfQty,
          reason:
            `[피라미딩] 수익률 +${pnlPct.toFixed(2)}% ≥ ${PYRAMIDING_PCT}% & ` +
            `MA5 상승 추세 확인 (현재가 ${currentPrice.toLocaleString()} > MA5 ${ma5Now?.toLocaleString()}) — ` +
            `${halfQty}주 추가 매수 (기존 ${quantity}주의 50%, 1회 한정)`,
          meta,
        };
      }
    }

    // ── 5순위: 보유 유지 (HOLD) ───────────────────────────────────────────
    /**
     * 위의 4가지 조건에 해당하지 않는 모든 경우
     *   → 추세가 지속 중이거나, 조건이 명확하지 않을 때
     *   → 감정적 의사결정 방지: 아무 신호 없으면 반드시 홀딩
     */
    return {
      type:     "HOLD",
      quantity: 0,
      reason:   "추세 지속 — 매매 조건 미충족, 보유 유지",
      meta,
    };
  }
}
