/**
 * 계좌·포지션 도메인 모델 — 순수 타입
 */

/** 계좌 잔고 */
export interface AccountBalance {
  /** 주문 가능 현금 (원) */
  cash: number;
  /** 자동매매 투입 자본 상한 (null = 전체 현금 사용) */
  autoTradeCapital: number | null;
}

/** 보유 포지션 (현재가·수익률 포함) */
export interface BrokerPosition {
  ticker:       string;
  name:         string;
  quantity:     number;
  avgPrice:     number;
  currentPrice: number;
  /** 수익률 (%), 소수점 2자리 */
  pnlPct:       number;
}
