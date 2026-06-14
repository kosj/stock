/**
 * 주문 도메인 모델 — 순수 타입 (외부 IO 의존 없음)
 *
 * 모의/백테스트/실전이 동일하게 사용하는 주문 계약(contract).
 * 멱등성 키(clientOrderId)로 재시도 시 중복 체결을 차단한다.
 */

export type OrderSide = "BUY" | "SELL";

/** 주문 유형 — Phase 1은 MARKET(시장가) 중심. LIMIT은 실전 어댑터에서 확장. */
export type OrderType = "MARKET" | "LIMIT";

/** 체결 조건 — DAY(당일), IOC(즉시일부), FOK(전량즉시) */
export type TimeInForce = "DAY" | "IOC" | "FOK";

/**
 * 주문 상태
 *   FILLED            전량 체결
 *   PARTIALLY_FILLED  일부 체결 (실전 비동기 체결 시)
 *   ACCEPTED          접수됨(미체결) — 실전 지정가 등
 *   REJECTED          거부 (잔금 부족·보유 부족 등)
 *   CANCELLED         취소됨
 */
export type OrderStatus =
  | "FILLED"
  | "PARTIALLY_FILLED"
  | "ACCEPTED"
  | "REJECTED"
  | "CANCELLED";

/** 주문 요청 — 전략 코어가 브로커 포트에 전달하는 입력 */
export interface OrderRequest {
  /**
   * 멱등성 키. 동일 키의 재요청은 브로커가 중복 체결하지 않고 기존 결과를 반환한다.
   * 권장 형식: `${userId}:${runDateKst}:${side}:${ticker}` (일 1회 전략 기준 유일).
   */
  clientOrderId: string;
  ticker:   string;
  name:     string;
  side:     OrderSide;
  quantity: number;
  type:     OrderType;
  /** LIMIT 주문 가격 (MARKET이면 무시) */
  limitPrice?: number;
  /** 사이징/모의 체결 기준가 (모의: 현재가). 실전 시장가에서는 참고용. */
  referencePrice: number;
  tif?: TimeInForce;
}

/** 주문 결과 — 브로커 포트가 반환하는 출력 */
export interface OrderResult {
  clientOrderId: string;
  /** 실전 브로커 주문번호 (모의: undefined) */
  brokerOrderId?: string;
  status:         OrderStatus;
  filledQuantity: number;
  /** 평균 체결가 (원) */
  avgFillPrice:   number;
  /** 체결 금액 (원) = filledQuantity × avgFillPrice */
  filledAmount:   number;
  /** 멱등성으로 무시된 재요청이면 true (이번 호출이 실제 체결을 일으키지 않음) */
  duplicate:      boolean;
  /** 거부/오류 사유 */
  error?:         string;
}

/** 체결 1건 (reconciliation·체결조회용) */
export interface Fill {
  clientOrderId?: string;
  ticker:   string;
  side:     OrderSide;
  quantity: number;
  price:    number;
  amount:   number;
  /** 체결 시각 (ISO 8601) */
  filledAt: string;
}
