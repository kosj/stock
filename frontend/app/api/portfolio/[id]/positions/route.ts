import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/server/supabase";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function getCurrentUserId(): Promise<string | null> {
  const client = await createSupabaseServerClient();
  const { data: { user } } = await client.auth.getUser();
  return user?.id ?? null;
}

async function verifyPortfolioOwner(portfolioId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("portfolios")
    .select("id")
    .eq("id", portfolioId)
    .eq("user_id", userId)
    .single();
  return !!data;
}

export async function GET(_: NextRequest, { params }: Ctx) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  if (!await verifyPortfolioOwner(id, userId)) {
    return NextResponse.json({ error: "권한 없음" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("positions")
    .select("*")
    .eq("portfolio_id", id)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  if (!await verifyPortfolioOwner(id, userId)) {
    return NextResponse.json({ error: "권한 없음" }, { status: 403 });
  }

  const body = await req.json();
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
