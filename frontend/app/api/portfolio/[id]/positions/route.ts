import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const { data, error } = await supabase
    .from("positions")
    .select("*")
    .eq("portfolio_id", id)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json();

  const { data: pf } = await supabase.from("portfolios").select("id").eq("id", id).single();
  if (!pf) return NextResponse.json({ error: "포트폴리오를 찾을 수 없습니다." }, { status: 404 });

  const { data, error } = await supabase
    .from("positions")
    .insert({
      portfolio_id: Number(id),
      ticker:       body.ticker,
      name:         body.name,
      quantity:     body.quantity,
      avg_price:    body.avg_price,
      stop_loss:    body.stop_loss ?? null,
      take_profit:  body.take_profit ?? null,
      strategy:     body.strategy ?? null,
      notes:        body.notes ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
