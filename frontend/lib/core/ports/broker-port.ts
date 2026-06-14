/**
 * BrokerPort — 주문 실행 포트 (헥사고날 아키텍처의 아웃바운드 포트)
 *
 * 전략 코어는 이 인터페이스에만 의존한다. 구현체(어댑터)는 계정별로 주입된다:
 *   - MockBrokerAdapter   : Supabase RPC 기반 모의 체결 (현재)
 *   - BacktestBrokerAdapter: 과거 데이터 리플레이 (Phase 2 예정)
 *   - KisBrokerAdapter    : 한국투자증권 실주문 (Phase 2 예정)
 *
 * 모든 주문은 clientOrderId로 멱등성을 보장한다 → 재시도/중복 호출 시 이중 체결 방지.
 */

import type { AccountBalance, BrokerPosition } from "../domain/account";
import type { OrderRequest, OrderResult, Fill } from "../domain/order";

export interface BrokerPort {
  /** 계좌 현금 잔고 및 자동매매 자본 상한 조회 */
  getBalance(): Promise<AccountBalance>;

  /** 보유 포지션 전체 조회 (현재가·수익률 포함) */
  getPositions(): Promise<BrokerPosition[]>;

  /**
   * 주문 실행 (멱등).
   * 동일 clientOrderId 재요청 시 중복 체결 없이 기존 결과를 duplicate=true로 반환.
   */
  placeOrder(req: OrderRequest): Promise<OrderResult>;

  /**
   * clientOrderId로 주문/체결 상태 조회 (reconciliation·재시도 판단용).
   * @returns 미존재 시 null
   */
  getOrderStatus(clientOrderId: string): Promise<OrderResult | null>;

  /** 체결 내역 조회 (실전 대사용) */
  getFills(opts?: { since?: Date; ticker?: string }): Promise<Fill[]>;

  /**
   * 미체결 주문 취소.
   * 즉시 체결(모의)인 경우 취소 불가 → 미지원 예외를 던질 수 있다.
   */
  cancelOrder(brokerOrderId: string): Promise<void>;
}
