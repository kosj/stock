import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/server/supabase";
import { getQuote } from "@/lib/server/yahoo-finance";
import { createBrokerProvider } from "@/lib/server/providers";
import type { BrokerType, BrokerProvider } from "@/lib/server/providers";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const KR_CODE = /^\d{6}$/;

async function fetchQuoteWithFallback(
  ticker: string,
  broker: BrokerProvider | null,
): Promise<{ price: number; change: number; change_pct: number } | null> {
  const yahoo = await getQuote(ticker);
  if (yahoo?.price != null) {
    return { price: yahoo.price, change: yahoo.change, change_pct: yahoo.change_pct };
  }

  // Yahoo 실패 + 브로커 + 국내 6자리 코드 → KIS 폴백
  if (broker && KR_CODE.test(ticker)) {
    try {
      const q = await broker.getQuote(ticker);
      if (q.price > 0) {
        return { price: q.price, change: q.change, change_pct: q.change_rate };
      }
    } catch {
      // 조용히 무시
    }
  }
  return null;
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;

  const { data: pf } = await supabase.from("portfolios").select("*").eq("id", id).single();
  if (!pf) return NextResponse.json({ error: "포트폴리오를 찾을 수 없습니다." }, { status: 404 });

  const { data: positions } = await supabase
    .from("positions")
    .select("*")
    .eq("portfolio_id", id);

  if (!positions || positions.length === 0) {
    return NextResponse.json({
      portfolio_id: Number(id),
      name: pf.name,
      total_invested: 0,
      total_value: 0,
      total_pnl: 0,
      total_pnl_percent: 0,
      positions: [],
    });
  }

  // 브로커 프로바이더 초기화 (헤더에서 자격증명 읽기)
  const brokerType = req.headers.get("x-broker-type") as BrokerType | null;
  const appKey     = req.headers.get("x-app-key");
  const appSecret  = req.headers.get("x-app-secret");
  let broker: BrokerProvider | null = null;
  if (brokerType && appKey && appSecret) {
    try { broker = createBrokerProvider(brokerType, { appKey, appSecret }); } catch {}
  }

  // 모든 종목 시세 병렬 조회 (Yahoo → KIS 폴백)
  const quotes = await Promise.allSettled(
    positions.map((p) => fetchQuoteWithFallback(p.ticker, broker))
  );

  let total_invested = 0;
  let total_value = 0;

  const pnlList = positions.map((pos, i) => {
    const q = quotes[i].status === "fulfilled" ? quotes[i].value : null;
    const price_available = q?.price != null;
    const current_price = q?.price ?? pos.avg_price;
    const cost_basis = pos.avg_price * pos.quantity;
    const total_val = current_price * pos.quantity;
    const pnl_amount = total_val - cost_basis;
    const pnl_percent = cost_basis ? (pnl_amount / cost_basis) * 100 : 0;

    total_invested += cost_basis;
    total_value += total_val;

    return {
      position_id:     pos.id,
      ticker:          pos.ticker,
      name:            pos.name,
      quantity:        pos.quantity,
      avg_price:       pos.avg_price,
      current_price,
      price_available,
      stop_loss:       pos.stop_loss,
      take_profit:     pos.take_profit,
      strategy:        pos.strategy,
      notes:           pos.notes,
      pnl_amount:      Math.round(pnl_amount),
      pnl_percent:     Math.round(pnl_percent * 100) / 100,
      total_value:     Math.round(total_val),
      cost_basis:      Math.round(cost_basis),
      is_near_stop:    pos.stop_loss != null && current_price <= pos.stop_loss * 1.05,
      is_near_target:  pos.take_profit != null && current_price >= pos.take_profit * 0.95,
    };
  });

  const total_pnl = total_value - total_invested;
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
