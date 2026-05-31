import { NextResponse } from "next/server";
import { supabase } from "@/lib/server/supabase";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const INITIAL_CASH = 10_000_000;

async function getUserId(): Promise<string | null> {
  const client = await createSupabaseServerClient();
  const { data: { user } } = await client.auth.getUser();
  return user?.id ?? null;
}

export async function POST() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  // 포지션 전체 삭제 + 현금 초기화 병렬 처리
  await Promise.all([
    supabase.from("mock_positions").delete().eq("user_id", userId),
    supabase.from("mock_accounts").upsert(
      { user_id: userId, cash: INITIAL_CASH, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    ),
  ]);

  return NextResponse.json({ ok: true, cash: INITIAL_CASH });
}
