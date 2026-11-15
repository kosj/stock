import { NextResponse } from "next/server";
import { supabase } from "@/lib/server/supabase";
import { requireApprovedUser } from "@/lib/server/require-user";

export const dynamic = "force-dynamic";

// Approved role is checked here as well as in middleware (defence in depth).
async function getUserId(): Promise<string | null> {
  const auth = await requireApprovedUser();
  return auth.ok ? auth.userId : null;
}

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { data, error } = await supabase
    .from("mock_trades")
    .select("id, ticker, name, trade_type, quantity, price, total_amount, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
