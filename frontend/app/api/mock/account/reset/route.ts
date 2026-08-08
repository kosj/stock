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

  // 포지션·거래이력 삭제 + 현금/자동매매자본 초기화 — 거래이력을 남기면
  // 리셋 후에도 과거 체결이 성과·이력 화면을 오염시킨다(분석에서 확인된 결함).
  await Promise.all([
    supabase.from("mock_positions").delete().eq("user_id", userId),
    supabase.from("mock_trades").delete().eq("user_id", userId),
    supabase.from("mock_accounts").upsert(
      { user_id: userId, cash: INITIAL_CASH, auto_trade_capital: null,
        updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    ),
  ]);

  return NextResponse.json({ ok: true, cash: INITIAL_CASH });
}
