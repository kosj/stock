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

export async function PUT(req: NextRequest, { params }: Ctx) {
  // auth + params + body 병렬 처리
  const [userId, { id }, body] = await Promise.all([getCurrentUserId(), params, req.json()]);
  if (!userId) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  // 소유권 확인 (positions → portfolios JOIN): 단일 쿼리
  const { data: ownership } = await supabase
    .from("positions")
    .select("portfolio_id, portfolios!inner(user_id)")
    .eq("id", id)
    .single();

  if (!ownership || (ownership.portfolios as unknown as { user_id: string }).user_id !== userId) {
    return NextResponse.json({ error: "권한 없음" }, { status: 403 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const fields = ["ticker", "name", "quantity", "avg_price", "stop_loss", "take_profit", "strategy", "notes"];
  for (const f of fields) {
    if (body[f] !== undefined) updates[f] = body[f];
  }

  const { data, error } = await supabase
    .from("positions")
    .update(updates)
    .eq("id", id)
    .select("id, ticker, name, quantity, avg_price, stop_loss, take_profit, strategy, notes, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

/** 포지션 삭제 — RPC delete_position_owned (소유권 검증 + DELETE 단일 왕복) */
export async function DELETE(_: NextRequest, { params }: Ctx) {
  const [userId, { id }] = await Promise.all([getCurrentUserId(), params]);
  if (!userId) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { data: deleted, error } = await supabase.rpc("delete_position_owned", {
    p_position_id: Number(id),
    p_user_id:     userId,
  });

  if (error)    return NextResponse.json({ error: error.message }, { status: 500 });
  if (!deleted) return NextResponse.json({ error: "권한 없음" }, { status: 403 });
  return new NextResponse(null, { status: 204 });
}
