import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server/require-user";
import { supabase } from "@/lib/server/supabase";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 20);
  const offset = Number(req.nextUrl.searchParams.get("offset") ?? 0);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
    return NextResponse.json({ error: "잘못된 페이지 범위" }, { status: 400 });
  const { data, error } = await supabase.from("mock_auto_trade_logs")
    .select("id,run_at,tickers_analyzed,trades_buy,trades_sell,skipped,details,error")
    .eq("user_id", auth.userId).order("run_at", { ascending: false }).order("id", { ascending: false })
    .range(offset, offset + limit);
  if (error) return NextResponse.json({ error: "로그 조회 실패" }, { status: 503 });
  return NextResponse.json({ items: (data ?? []).slice(0, limit), nextOffset: (data?.length ?? 0) > limit ? offset + limit : null });
}
