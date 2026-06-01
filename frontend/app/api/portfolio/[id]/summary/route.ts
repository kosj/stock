import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/server/supabase";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getQuote } from "@/lib/server/yahoo-finance";
import { createBrokerProvider } from "@/lib/server/providers";
import type { BrokerType, BrokerProvider } from "@/lib/server/providers";

export const dynamic     = "force-dynamic";
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

const KR_CODE = /^\d{6}$/;

async function fetchQuoteWithFallback(
  ticker: string,
  broker: BrokerProvider | null,
): Promise<{ price: number; change: number; change_pct: number } | null> {
  if (broker && KR_CODE.test(ticker)) {
    try {
      const q = await broker.getQuote(ticker);
      if (q.price > 0) return { price: q.price, change: q.change, change_pct: q.change_rate };
    } catch { /* KIS 실패 → Yahoo 폴백 */ }
  }
  const yahoo = await getQuote(ticker);
  if (yahoo?.price != null && yahoo.price > 0) {
    return { price: yahoo.price, change: yahoo.change, change_pct: yahoo.change_pct };
  }
  return null;
}

export async function GET(req: NextRequest, { params }: Ctx) {
  // auth + params 병렬 처리
  const [serverClient, { id }] = await Promise.all([
    createSupabaseServerClient(),
    params,
  ]);
  const { data: { user } } = await serverClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  // portfolios + positions 병렬 조회 + 필요 컬럼만 select
  const [{ data: pf }, { data: positions }] = await Promise.all([
    supabase
      .from("portfolios")
      .select("id, name")           // description·created_at·updated_at 제외
      .eq("id", id)
      .eq("user_id", user.id)
      .single(),
    supabase
      .from("positions")
      .select("id, ticker, name, quantity, avg_price, stop_loss, take_profit, strategy, notes")
      .eq("portfolio_id", id),      // created_at·updated_at·portfolio_id 제외
  ]);

  if (!pf) return NextResponse.json({ error: "포트폴리오를 찾을 수 없습니다." }, { status: 404 });

  if (!positions || positions.length === 0) {
    return NextResponse.json({
      portfolio_id:      Number(id),
      name:              pf.name,
      total_invested:    0,
      total_value:       0,
      total_pnl:         0,
      total_pnl_percent: 0,
      positions:         [],
    });
  }

  // 브로커 초기화
  const brokerType = req.headers.get("x-broker-type") as BrokerType | null;
  const appKey     = req.headers.get("x-app-key");
  const appSecret  = req.headers.get("x-app-secret");
  let broker: BrokerProvider | null = null;
  if (brokerType && appKey && appSecret) {
    try { broker = createBrokerProvider(brokerType, { appKey, appSecret }); } catch {}
  }

  // 모든 종목 시세 조회 — 5개씩 배치 처리 (Yahoo IP 차단 방지)
  async function batchAllSettled<T, R>(
    items: T[],
    fn: (item: T) => Promise<R>,
    size = 5,
  ): Promise<PromiseSettledResult<R>[]> {
    const results: PromiseSettledResult<R>[] = [];
    for (let i = 0; i < items.length; i += size) {
      const chunk = items.slice(i, i + size);
      results.push(...await Promise.allSettled(chunk.map(fn)));
    }
    return results;
  }

  const quotes = await batchAllSettled(
    positions,
    (p) => fetchQuoteWithFallback(p.ticker, broker),
    5,
  );

  let total_invested = 0;
  let total_value    = 0;

  const pnlList = positions.map((pos, i) => {
    const q             = quotes[i].status === "fulfilled" ? quotes[i].value : null;
    const current_price = q?.price ?? pos.avg_price;
    const cost_basis    = pos.avg_price * pos.quantity;
    const total_val     = current_price * pos.quantity;
    const pnl_amount    = total_val - cost_basis;
    const pnl_percent   = cost_basis ? (pnl_amount / cost_basis) * 100 : 0;

    total_invested += cost_basis;
    total_value    += total_val;

    return {
      position_id:    pos.id,
      ticker:         pos.ticker,
      name:           pos.name,
      quantity:       pos.quantity,
      avg_price:      pos.avg_price,
      current_price,
      price_available: q?.price != null,
      stop_loss:      pos.stop_loss,
      take_profit:    pos.take_profit,
      strategy:       pos.strategy,
      notes:          pos.notes,
      pnl_amount:     Math.round(pnl_amount),
      pnl_percent:    Math.round(pnl_percent * 100) / 100,
      total_value:    Math.round(total_val),
      cost_basis:     Math.round(cost_basis),
      is_near_stop:   pos.stop_loss   != null && current_price <= pos.stop_loss   * 1.05,
      is_near_target: pos.take_profit != null && current_price >= pos.take_profit * 0.95,
    };
  });

  const total_pnl        = total_value - total_invested;
  const total_pnl_percent = total_invested ? (total_pnl / total_invested) * 100 : 0;

  return NextResponse.json({
    portfolio_id:      Number(id),
    name:              pf.name,
    total_invested:    Math.round(total_invested),
    total_value:       Math.round(total_value),
    total_pnl:         Math.round(total_pnl),
    total_pnl_percent: Math.round(total_pnl_percent * 100) / 100,
    positions:         pnlList,
  });
}
