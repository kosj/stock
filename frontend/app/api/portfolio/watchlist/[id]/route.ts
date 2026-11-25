import { NextRequest, NextResponse } from "next/server";
import { dbErrorResponse } from "@/lib/server/db-error";
import { supabase } from "@/lib/server/supabase";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_: NextRequest, { params }: Ctx) {
  // auth + params 병렬 처리
  const [serverClient, { id }] = await Promise.all([
    createSupabaseServerClient(),
    params,
  ]);
  const { data: { user } } = await serverClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  // user_id를 WHERE에 포함 → 소유권 검증 + 삭제 단일 쿼리
  const { error } = await supabase
    .from("watchlist")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return dbErrorResponse(error, "watchlist/[id] DELETE", "관심 종목을 삭제하지 못했습니다.");
  return new NextResponse(null, { status: 204 });
}
