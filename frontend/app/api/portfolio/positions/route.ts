import { NextResponse } from "next/server";
import { supabase } from "@/lib/server/supabase";
import { requireUser } from "@/lib/server/require-user";

export const dynamic = "force-dynamic";

// GET /api/portfolio/positions — 손절가/목표가가 설정된 "내" 포지션만 반환
// (이전에는 인증·user 스코프가 없어 전 사용자 포지션이 노출됐다. service-role
//  클라이언트라 RLS로도 막히지 않으므로 라우트에서 직접 스코프를 건다.)
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  // 내 포트폴리오 id 집합으로 제한
  const { data: myPfs, error: pfErr } = await supabase
    .from("portfolios")
    .select("id")
    .eq("user_id", auth.userId);
  if (pfErr) return NextResponse.json({ error: pfErr.message }, { status: 500 });

  const ids = (myPfs ?? []).map((p: { id: number }) => p.id);
  if (ids.length === 0) return NextResponse.json([]);

  const { data, error } = await supabase
    .from("positions")
    .select("id, portfolio_id, ticker, name, quantity, avg_price, stop_loss, take_profit")
    .in("portfolio_id", ids)
    .or("stop_loss.not.is.null,take_profit.not.is.null")
    .order("ticker");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
