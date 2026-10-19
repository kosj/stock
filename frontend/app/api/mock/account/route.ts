import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/server/supabase";
import { requireUser } from "@/lib/server/require-user";
import { getQuote } from "@/lib/server/yahoo-finance";
import { accountEpoch, updateAccount } from "@/lib/server/mock-account-control";
export const dynamic = "force-dynamic";
export const maxDuration = 20;
interface Position { ticker: string; name: string; quantity: number; avg_price: number }
interface Snapshot { cash: number; auto_trade_capital: number | null; account_epoch: number; performance_baseline: number; baseline_at: string; net_cash_adjustments: number; realized_pnl: number; recorded_costs: number; cost_history_complete: boolean; positions: Position[] }
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  try {
    await accountEpoch(auth.userId);
    const { data, error } = await supabase.rpc("mock_account_snapshot", { p_user_id: auth.userId });
    if (error || !data) throw new Error(error?.message ?? "계좌 조회 실패");
    const a = data as Snapshot;
    const positions = [];
    let stockValue = 0;
    for (let i = 0; i < a.positions.length; i += 10) {
      const batch = a.positions.slice(i, i + 10);
      const quotes = await Promise.allSettled(batch.map(p => getQuote(p.ticker)));
      for (const [j, p] of batch.entries()) {
        const q = quotes[j];
        const price = q.status === "fulfilled" && q.value && Number.isFinite(q.value.price) && q.value.price > 0 ? q.value.price : null;
        const current_price = price ?? p.avg_price;
        stockValue += current_price * p.quantity;
        positions.push({ ...p, current_price, price_stale: price === null,
          pnl_amount: (current_price - p.avg_price) * p.quantity,
          pnl_pct: p.avg_price > 0 ? (current_price / p.avg_price - 1) * 100 : 0 });
      }
    }
    const totalValue = a.cash + stockValue;
    const capital = a.performance_baseline + a.net_cash_adjustments;
    const totalPnl = totalValue - capital;
    return NextResponse.json({ ...a, positions, stock_value: stockValue, total_value: totalValue,
      total_pnl: totalPnl, total_pnl_pct: capital > 0 ? totalPnl / capital * 100 : null,
      unrealized_pnl: positions.reduce((s, p) => s + p.pnl_amount, 0),
      valuation_stale: positions.some(p => p.price_stale),
      return_method: "baseline_plus_net_deposits" });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "계좌 조회 실패" }, { status: 503 }); }
}
export async function PUT(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  for (const key of ["cash", "auto_trade_capital"]) {
    if (key in body && !(key === "auto_trade_capital" && body[key] === null)
      && (typeof body[key] !== "number" || !Number.isFinite(body[key]) || body[key] < 0 || body[key] > 1_000_000_000))
      return NextResponse.json({ error: "금액은 0~10억원 범위여야 합니다." }, { status: 400 });
  }
  try { return NextResponse.json(await updateAccount(auth.userId, body)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "계좌 변경 실패" }, { status: 409 }); }
}
