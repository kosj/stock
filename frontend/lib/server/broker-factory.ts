/**
 * 계정(user) 기준 브로커 어댑터 선택 팩토리
 *
 * 핵심 원칙: 모의/실전 투자는 **계정(user_id) 단위로 개인화**된다.
 *   - 거래 모드(mock | real)를 mock_accounts.trading_mode에서 계정별로 조회
 *   - 모드에 맞는 BrokerPort 구현체(어댑터)를 주입(DI)용으로 반환
 *
 * Phase 0: 모든 계정이 모의(Mock). 'real' 모드는 어댑터 미구현 → 안전하게 거부.
 * Phase 2: KisBrokerAdapter(계정별 자격증명 주입)를 'real' 분기에 연결 예정.
 *
 * 자동매매 진입점(Cron / 수동 UI)은 반드시 이 팩토리를 통해 브로커를 얻어야
 * 단일 엔진(TradingEngineService)이 계정별로 올바른 시장(모의/실전)에 주문한다.
 */

import { supabase } from "./supabase";
import { MockBrokerAdapter } from "./adapters/mock-broker-adapter";
import type { BrokerPort } from "@/lib/core/ports/broker-port";

/** 계정별 거래 모드 */
export type TradingMode = "mock" | "real";

/**
 * 계정의 거래 모드 조회.
 *
 * mock_accounts.trading_mode 컬럼을 읽되, 컬럼 미생성(마이그레이션 전)이나
 * 조회 실패 시에는 안전하게 'mock'으로 폴백한다. → 실전으로 잘못 빠지는 사고 방지.
 */
export async function getTradingModeForUser(userId: string): Promise<TradingMode> {
  const { data, error } = await supabase
    .from("mock_accounts")
    .select("trading_mode")
    .eq("user_id", userId)
    .maybeSingle();

  // 컬럼 미존재/조회 오류/미설정 → 보수적으로 모의 모드
  if (error || !data) return "mock";
  return data.trading_mode === "real" ? "real" : "mock";
}

/**
 * 계정에 맞는 브로커 어댑터 반환.
 *
 * @throws 'real' 모드인데 실전 어댑터가 아직 없을 때 — 모의 RPC로 실전 계정을
 *         잘못 체결하는 것을 막기 위해 의도적으로 예외를 던진다.
 */
export async function getBrokerForUser(userId: string): Promise<BrokerPort> {
  const mode = await getTradingModeForUser(userId);

  if (mode === "real") {
    // Phase 2에서 KisBrokerAdapter(자격증명: getFirstBrokerConfig(userId))로 교체
    throw new Error(
      `[${userId}] 실전 매매 모드는 아직 활성화되지 않았습니다 ` +
      `(Phase 2에서 KIS 실주문 어댑터 추가 예정).`,
    );
  }

  return new MockBrokerAdapter(userId);
}
