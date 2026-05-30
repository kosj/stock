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

async function verifyPositionOwner(positionId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("positions")
    .select("portfolio_id, portfolios!inner(user_id)")
    .eq("id", positionId)
    .single();
  if (!data) return false;
  return (data.portfolios as unknown as { user_id: string }).user_id === userId;
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  if (!await verifyPositionOwner(id, userId)) {
    return NextResponse.json({ error: "권한 없음" }, { status: 403 });
  }

  const body = await req.json();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const fields = ["ticker", "name", "quantity", "avg_price", "stop_loss", "take_profit", "strategy", "notes"];
  for (const f of fields) {
    if (body[f] !== undefined) updates[f] = body[f];
  }

  const { data, error } = await supabase
    .from("positions")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_: NextRequest, { params }: Ctx) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  if (!await verifyPositionOwner(id, userId)) {
    return NextResponse.json({ error: "권한 없음" }, { status: 403 });
  }

  const { error } = await supabase.from("positions").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
