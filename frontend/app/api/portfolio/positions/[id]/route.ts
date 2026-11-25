import { NextRequest, NextResponse } from "next/server";
import { readJsonObject } from "@/lib/server/read-json";
import { dbErrorResponse } from "@/lib/server/db-error";
import { supabase } from "@/lib/server/supabase";
import { requireUser } from "@/lib/server/require-user";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 포지션 수정 — RPC update_position_owned (소유권 검증 + UPDATE 단일 왕복) */
export async function PUT(req: NextRequest, { params }: Ctx) {
  const [auth, { id }, parsed] = await Promise.all([requireUser(), params, readJsonObject(req)]);
  if (!auth.ok) return auth.response;
  const userId = auth.userId;
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

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
    return dbErrorResponse(error, "positions/[id] PUT", "포지션을 수정하지 못했습니다.");
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return NextResponse.json({ error: "권한 없음" }, { status: 403 });
  return NextResponse.json(row);
}

/** 포지션 삭제 — RPC delete_position_owned (소유권 검증 + DELETE 단일 왕복) */
export async function DELETE(_: NextRequest, { params }: Ctx) {
  const [auth, { id }] = await Promise.all([requireUser(), params]);
  if (!auth.ok) return auth.response;
  const userId = auth.userId;

  const { data: deleted, error } = await supabase.rpc("delete_position_owned", {
    p_position_id: Number(id),
    p_user_id:     userId,
  });

  if (error)    return dbErrorResponse(error, "positions/[id] DELETE", "포지션을 삭제하지 못했습니다.");
  if (!deleted) return NextResponse.json({ error: "권한 없음" }, { status: 403 });
  return new NextResponse(null, { status: 204 });
}
