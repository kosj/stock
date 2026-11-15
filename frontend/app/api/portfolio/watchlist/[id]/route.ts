import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/server/supabase";
import { requireApprovedUser } from "@/lib/server/require-user";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_: NextRequest, { params }: Ctx) {
  // auth + params 병렬 처리
  // Approved role is checked here as well as in middleware (defence in depth).
  const [auth, { id }] = await Promise.all([requireApprovedUser(), params]);
  if (!auth.ok) return auth.response;
  const user = { id: auth.userId };

  // user_id를 WHERE에 포함 → 소유권 검증 + 삭제 단일 쿼리
  const { error } = await supabase
    .from("watchlist")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
