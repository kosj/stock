import { NextResponse } from "next/server";
import { supabase } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

// GET /api/portfolio/positions — 손절가 또는 목표가가 설정된 전체 포지션 반환
export async function GET() {
  const { data, error } = await supabase
    .from("positions")
    .select("id, portfolio_id, ticker, name, quantity, avg_price, stop_loss, take_profit")
    .or("stop_loss.not.is.null,take_profit.not.is.null")
    .order("ticker");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
