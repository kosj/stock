/**
 * MockBrokerAdapter — BrokerPort 구현 (Supabase RPC 기반 모의 체결)
 *
 * 기존 MockBrokerApiService를 포트 계약(BrokerPort)으로 승격하고 멱등성을 추가.
 *   - 브로커는 계정(user_id)에 바인딩된다 (모의/실전 모두 계정 기준 개인화 원칙).
 *   - placeOrder는 clientOrderId를 RPC에 전달 → 동일 키 재요청 시 DB가 중복 체결 차단.
 *   - 멱등 RPC(6-arg) 마이그레이션 전이면 PGRST202를 감지해 레거시(5-arg)로 폴백
 *     (비멱등, 단 서비스 중단 없음). 마이그레이션 후 자동으로 멱등 동작.
 *
 * 모의 체결은 즉시 확정되므로 cancelOrder는 미지원.
 */

import { supabase } from "../supabase";
import { YahooMarketDataAdapter } from "./yahoo-market-data-adapter";
import type { BrokerPort } from "@/lib/core/ports/broker-port";
import type { MarketDataPort } from "@/lib/core/ports/market-data-port";
import type { AccountBalance, BrokerPosition } from "@/lib/core/domain/account";
import type { OrderRequest, OrderResult, Fill, OrderSide } from "@/lib/core/domain/order";

const INITIAL_CASH = 10_000_000;

/** 멱등 RPC 미적용(마이그레이션 전) 시 PostgREST가 반환하는 함수 미존재 코드 */
const PGRST_FN_NOT_FOUND = "PGRST202";

/** RPC 성공 반환 형태 */
interface RpcOrderResponse {
  ok:            boolean;
  duplicate?:    boolean;
  price?:        number;
  total_amount?: number;
  new_cash?:     number;
}

export class MockBrokerAdapter implements BrokerPort {
  constructor(
    private readonly userId: string,
    private readonly market: MarketDataPort = new YahooMarketDataAdapter(),
  ) {}

  async getBalance(): Promise<AccountBalance> {
    // 없으면 INITIAL_CASH로 생성, 있으면 유지
    await supabase
      .from("mock_accounts")
      .upsert({ user_id: this.userId, cash: INITIAL_CASH }, { onConflict: "user_id", ignoreDuplicates: true });

    const { data } = await supabase
      .from("mock_accounts")
      .select("cash, auto_trade_capital")
      .eq("user_id", this.userId)
      .single();

    return {
      cash:             data?.cash ?? INITIAL_CASH,
      autoTradeCapital: data?.auto_trade_capital ?? null,
    };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const { data: positions } = await supabase
      .from("mock_positions")
      .select("ticker, name, quantity, avg_price")
      .eq("user_id", this.userId);

    if (!positions?.length) return [];

    // 현재가 병렬 조회 (부분 실패 허용 — 실패 시 avg_price로 대체)
    const quotes = await Promise.allSettled(positions.map((p) => this.market.getQuote(p.ticker)));

    return positions.map((pos, i) => {
      const q = quotes[i];
      const currentPrice =
        q.status === "fulfilled" && q.value?.price && q.value.price > 0 ? q.value.price : pos.avg_price;
      const pnlPct = pos.avg_price > 0 ? ((currentPrice - pos.avg_price) / pos.avg_price) * 100 : 0;
      return {
        ticker:       pos.ticker,
        name:         pos.name,
        quantity:     pos.quantity,
        avgPrice:     pos.avg_price,
        currentPrice,
        pnlPct:       Math.round(pnlPct * 100) / 100,
      };
    });
  }

  async placeOrder(req: OrderRequest): Promise<OrderResult> {
    const rpcName = req.side === "BUY" ? "execute_mock_buy" : "execute_mock_sell";
    // 모의 체결가 = 기준가(현재가). 소수 2자리 반올림.
    const price = Math.round(req.referencePrice * 100) / 100;

    // 레거시(5-arg) 파라미터 + 멱등성 키
    const base = {
      p_user_id:  this.userId,
      p_ticker:   req.ticker,
      p_name:     req.name,
      p_quantity: req.quantity,
      p_price:    price,
    };

    let { data, error } = await supabase.rpc(rpcName, { ...base, p_client_order_id: req.clientOrderId });

    // 멱등 RPC 미적용(마이그레이션 전) → 레거시 5-arg로 폴백 (비멱등)
    if (error && error.code === PGRST_FN_NOT_FOUND) {
      console.warn(
        `[MockBrokerAdapter] 멱등 RPC 미적용 — ${rpcName} 레거시 폴백(비멱등). ` +
        `supabase-migration.sql 적용 필요.`,
      );
      ({ data, error } = await supabase.rpc(rpcName, base));
    }

    if (error) {
      return this.rejected(req.clientOrderId, error.message);
    }

    const res = (data ?? {}) as RpcOrderResponse;
    const fillPrice = res.price ?? price;
    return {
      clientOrderId:  req.clientOrderId,
      status:         "FILLED",
      filledQuantity: req.quantity,
      avgFillPrice:   fillPrice,
      filledAmount:   res.total_amount ?? Math.round(req.quantity * fillPrice),
      duplicate:      res.duplicate === true,
    };
  }

  async getOrderStatus(clientOrderId: string): Promise<OrderResult | null> {
    const { data, error } = await supabase
      .from("mock_trades")
      .select("quantity, price, total_amount")
      .eq("user_id", this.userId)
      .eq("client_order_id", clientOrderId)
      .maybeSingle();

    if (error || !data) return null;
    return {
      clientOrderId,
      status:         "FILLED",
      filledQuantity: data.quantity,
      avgFillPrice:   data.price,
      filledAmount:   data.total_amount,
      duplicate:      false,
    };
  }

  async getFills(opts?: { since?: Date; ticker?: string }): Promise<Fill[]> {
    let query = supabase
      .from("mock_trades")
      .select("ticker, trade_type, quantity, price, total_amount, created_at, client_order_id")
      .eq("user_id", this.userId)
      .order("created_at", { ascending: false });

    if (opts?.since)  query = query.gte("created_at", opts.since.toISOString());
    if (opts?.ticker) query = query.eq("ticker", opts.ticker);

    const { data, error } = await query;
    if (error || !data) return [];

    return data.map((t) => ({
      clientOrderId: t.client_order_id ?? undefined,
      ticker:        t.ticker,
      side:          t.trade_type as OrderSide,
      quantity:      t.quantity,
      price:         t.price,
      amount:        t.total_amount,
      filledAt:      t.created_at,
    }));
  }

  async cancelOrder(): Promise<void> {
    throw new Error("모의 체결은 즉시 확정되어 취소할 수 없습니다.");
  }

  private rejected(clientOrderId: string, message: string): OrderResult {
    return {
      clientOrderId,
      status:         "REJECTED",
      filledQuantity: 0,
      avgFillPrice:   0,
      filledAmount:   0,
      duplicate:      false,
      error:          message,
    };
  }
}
