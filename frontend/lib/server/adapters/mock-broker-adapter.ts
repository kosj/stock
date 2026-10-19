/**
 * MockBrokerAdapter — BrokerPort 구현 (Supabase RPC 기반 모의 체결)
 *
 * 기존 MockBrokerApiService를 포트 계약(BrokerPort)으로 승격하고 멱등성을 추가.
 *   - 브로커는 계정(user_id)에 바인딩된다 (모의/실전 모두 계정 기준 개인화 원칙).
 *   - placeOrder는 clientOrderId를 RPC에 전달 → 동일 키 재요청 시 DB가 중복 체결 차단.
 *   - 멱등 RPC 미설치 시 fail-closed. 비멱등 레거시 RPC로 폴백하지 않는다.
 *
 * 모의 체결은 즉시 확정되므로 cancelOrder는 미지원.
 */

import { supabase } from "../supabase";
import { YahooMarketDataAdapter } from "./yahoo-market-data-adapter";
import { KrMarketClock } from "./kr-market-clock";
import { effectivePrice } from "../../core/execution-policy";
import { mockCosts } from "../mock-execution";
import { accountEpoch } from "../mock-account-control";
import type { BrokerPort } from "@/lib/core/ports/broker-port";
import type { MarketDataPort } from "@/lib/core/ports/market-data-port";
import type { AccountBalance, BrokerPosition } from "@/lib/core/domain/account";
import type { OrderRequest, OrderResult, Fill, OrderSide } from "@/lib/core/domain/order";

const INITIAL_CASH = 10_000_000;

/** RPC 성공 반환 형태 */
interface RpcOrderResponse {
  ok:            boolean;
  duplicate?:    boolean;
  price?:        number;
  total_amount?: number;
  quantity?:     number;
  new_cash?:     number;
}

export class MockBrokerAdapter implements BrokerPort {
  private epoch: number | null = null;
  constructor(
    private readonly userId: string,
    private readonly market: MarketDataPort = new YahooMarketDataAdapter(),
    private executionOwner?: string,
  ) {}

  bindExecutionOwner(owner: string): void { this.executionOwner = owner; }

  async getBalance(): Promise<AccountBalance> {
    this.epoch ??= await accountEpoch(this.userId);
    // 없으면 INITIAL_CASH로 생성, 있으면 유지
    const { error: initError } = await supabase
      .from("mock_accounts")
      .upsert({ user_id: this.userId, cash: INITIAL_CASH }, { onConflict: "user_id", ignoreDuplicates: true });

    if (initError) throw new Error(initError.message);
    const { data, error } = await supabase
      .from("mock_accounts")
      .select("cash, auto_trade_capital")
      .eq("user_id", this.userId)
      .single();

    if (error || !data) throw new Error(error?.message ?? "계좌 조회 실패");
    return {
      cash:             data?.cash ?? INITIAL_CASH,
      autoTradeCapital: data?.auto_trade_capital ?? null,
    };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const { data: positions, error } = await supabase
      .from("mock_positions")
      .select("ticker, name, quantity, avg_price")
      .eq("user_id", this.userId);

    if (error) throw new Error(error.message);
    if (!positions?.length) return [];

    // 현재가 병렬 조회 (부분 실패 허용 — 실패 시 avg_price로 대체)
    const quotes = await Promise.allSettled(positions.map((p) => this.market.getQuote(p.ticker)));

    return positions.map((pos, i) => {
      const q = quotes[i];
      // 값 직접 추출 — 불리언 경유 내로잉은 q.value의 null을 좁히지 못한다(빌드 오류)
      const quotedPrice =
        q.status === "fulfilled" && q.value?.price && Number.isFinite(q.value.price) && q.value.price > 0 ? q.value.price : null;
      // 폴백은 표시용일 뿐 — priceStale로 표시해 손절 등 매매 판단에서 제외시킨다.
      // (기존에는 폴백이 손익 0%로 위장돼 손절이 영원히 미발동하는 결함이 있었다)
      const currentPrice = quotedPrice ?? pos.avg_price;
      const pnlPct = pos.avg_price > 0 ? ((currentPrice - pos.avg_price) / pos.avg_price) * 100 : 0;
      if (quotedPrice === null) {
        console.warn(`[mock-broker] ${pos.ticker} 시세 조회 실패 — 평단 폴백(priceStale)`);
      }
      return {
        priceStale:   quotedPrice === null,
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
    if (!/^\d{6}$/.test(req.ticker)) return this.rejected(req.clientOrderId, "원화 모의계좌는 국내 6자리 종목만 지원합니다.");
    if (!new KrMarketClock().isMarketOpen()) return this.rejected(req.clientOrderId, "정규장 외 주문 거부");
    if (!Number.isSafeInteger(req.quantity) || req.quantity <= 0) return this.rejected(req.clientOrderId, "유효하지 않은 주문 수량");
    if (!this.executionOwner || this.epoch === null) return this.rejected(req.clientOrderId, "계좌 실행 잠금/세대 미확인");
    // 모의 체결가 = 기준가(현재가). 소수 2자리 반올림.
    const price = effectivePrice(req.referencePrice, req.side, mockCosts(req.ticker));

    // 레거시(5-arg) 파라미터 + 멱등성 키
    const base = {
      p_user_id:  this.userId,
      p_ticker:   req.ticker,
      p_name:     req.name,
      p_quantity: req.quantity,
      p_price:    price,
    };

    const { data, error } = await supabase.rpc("execute_mock_order", { ...base, p_client_order_id: req.clientOrderId,
      p_side: req.side, p_account_epoch: this.epoch, p_execution_owner: this.executionOwner, p_reference_price: req.referencePrice });

    if (error) {
      return this.rejected(req.clientOrderId, error.message);
    }

    const res = (data ?? {}) as RpcOrderResponse;
    if (res.ok !== true) return this.rejected(req.clientOrderId, "체결 확인 실패");
    const fillPrice = res.price ?? price;
    return {
      clientOrderId:  req.clientOrderId,
      status:         "FILLED",
      filledQuantity: res.quantity ?? req.quantity,
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
      .eq("client_order_id", `${this.epoch ?? await accountEpoch(this.userId)}:${clientOrderId}`)
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
    if (error || !data) throw new Error(error?.message ?? "체결 이력 조회 실패");

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
