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

/** 포지션 수정 — RPC update_position_owned (소유권 검증 + UPDATE 단일 왕복) */
export async function PUT(req: NextRequest, { params }: Ctx) {
  const [userId, { id }, body] = await Promise.all([getCurrentUserId(), params, req.json()]);
  if (!userId) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { data, error } = await supabase.rpc("update_position_owned", {
    p_position_id: Number(id),
    p_user_id:     userId,
    p_ticker:      body.ticker,
    p_name:        body.name,
    p_quantity:    body.quantity,
    p_avg_price:   body.avg_price,
    p_stop_loss:   body.stop_loss   ?? null,
    p_take_profit: body.take_profit ?? null,
    p_strategy:    body.strategy    ?? null,
    p_notes:       body.notes       ?? null,
  });

  if (error) {
    if (error.message.includes("permission_denied")) {
      return NextResponse.json({ error: "권한 없음" }, { status: 403 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return NextResponse.json({ error: "권한 없음" }, { status: 403 });
  return NextResponse.json(row);
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
