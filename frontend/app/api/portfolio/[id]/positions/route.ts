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

export async function GET(_: NextRequest, { params }: Ctx) {
  // auth + params 병렬 처리
  const [userId, { id }] = await Promise.all([getCurrentUserId(), params]);
  if (!userId) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  // 소유권 확인 + 데이터 조회 병렬 실행 (2페이즈: auth‖params → verify‖fetch)
  const [{ data: pf }, { data, error }] = await Promise.all([
    supabase.from("portfolios").select("id").eq("id", id).eq("user_id", userId).single(),
    supabase
      .from("positions")
      .select("id, ticker, name, quantity, avg_price, stop_loss, take_profit, strategy, notes, created_at")
      .eq("portfolio_id", id)
      .order("created_at", { ascending: true }),
  ]);

  if (!pf) return NextResponse.json({ error: "권한 없음" }, { status: 403 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

/** 포트폴리오의 모든 포지션 삭제 */
export async function DELETE(_: NextRequest, { params }: Ctx) {
  const [userId, { id }] = await Promise.all([getCurrentUserId(), params]);
  if (!userId) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  // 소유권 확인 후 삭제 (delete는 안전을 위해 순차 실행)
  const { data: pf } = await supabase
    .from("portfolios").select("id").eq("id", id).eq("user_id", userId).single();
  if (!pf) return NextResponse.json({ error: "권한 없음" }, { status: 403 });

  const { error } = await supabase.from("positions").delete().eq("portfolio_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** 포지션 추가 — RPC insert_position_owned (소유권 검증 + INSERT 단일 왕복) */
export async function POST(req: NextRequest, { params }: Ctx) {
  const [userId, { id }, body] = await Promise.all([getCurrentUserId(), params, req.json()]);
  if (!userId) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { data, error } = await supabase.rpc("insert_position_owned", {
    p_portfolio_id: Number(id),
    p_user_id:      userId,
    p_ticker:       body.ticker,
    p_name:         body.name,
    p_quantity:     body.quantity,
    p_avg_price:    body.avg_price,
    p_stop_loss:    body.stop_loss    ?? null,
    p_take_profit:  body.take_profit  ?? null,
    p_strategy:     body.strategy     ?? null,
    p_notes:        body.notes        ?? null,
  });

  if (error) {
    if (error.message.includes("permission_denied")) {
      return NextResponse.json({ error: "권한 없음" }, { status: 403 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json(row, { status: 201 });
}
