import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/server/supabase";
import { getQuote } from "@/lib/server/yahoo-finance";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Ctx) {
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

  // 모든 종목 시세 병렬 조회
  const quotes = await Promise.allSettled(
    positions.map((p) => getQuote(p.ticker))
  );

  let total_invested = 0;
  let total_value = 0;

  const pnlList = positions.map((pos, i) => {
    const q = quotes[i].status === "fulfilled" ? quotes[i].value : null;
    const price_available = q?.price != null;
    // 시세 미지원 종목은 평균단가를 현재가로 대체 (P&L = 0으로 표시됨)
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
