import { NextResponse } from "next/server";
import { dbErrorResponse } from "@/lib/server/db-error";
import { supabase } from "@/lib/server/supabase";
import { requireUser } from "@/lib/server/require-user";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const userId = auth.userId;

  const { data, error } = await supabase
    .from("mock_trades")
    .select("id, ticker, name, trade_type, quantity, price, total_amount, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return dbErrorResponse(error, "mock/trades GET", "체결 내역을 불러오지 못했습니다.");
  return NextResponse.json(data ?? []);
}
