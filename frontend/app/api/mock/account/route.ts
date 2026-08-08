import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/server/supabase";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getQuote } from "@/lib/server/yahoo-finance";

export const dynamic    = "force-dynamic";
export const maxDuration = 20;

const INITIAL_CASH = 10_000_000;

async function getUserId(): Promise<string | null> {
  const client = await createSupabaseServerClient();
  const { data: { user } } = await client.auth.getUser();
  return user?.id ?? null;
}

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  // 계좌 + 포지션 병렬 조회 (계좌가 없는 경우에만 INSERT — 최초 1회)
  const [{ data: existing }, { data: positions }] = await Promise.all([
    supabase.from("mock_accounts")
      .select("cash, auto_trade_capital")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase.from("mock_positions")
      .select("ticker, name, quantity, avg_price")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false }),
  ]);

  const account = existing ?? (
    await supabase.from("mock_accounts")
      .insert({ user_id: userId, cash: INITIAL_CASH })
      .select("cash, auto_trade_capital")
      .single()
  ).data;

  if (!account) return NextResponse.json({ error: "계좌 조회 실패" }, { status: 500 });

  const rows = positions ?? [];

  // 현재가 10개씩 배치 병렬 조회 (Yahoo 과부하 방지)
  async function batchAllSettled<T, R>(
    items: T[],
    fn: (item: T) => Promise<R>,
    size = 10,
  ): Promise<PromiseSettledResult<R>[]> {
    const out: PromiseSettledResult<R>[] = [];
    for (let i = 0; i < items.length; i += size) {
      out.push(...await Promise.allSettled(items.slice(i, i + size).map(fn)));
    }
    return out;
  }

  const quotes = await batchAllSettled(rows, p => getQuote(p.ticker));

  let stock_value = 0;
  const enriched = rows.map((pos, i) => {
    const q             = quotes[i].status === "fulfilled" ? quotes[i].value : null;
    const current_price = q?.price ?? pos.avg_price;
    const pnl_amount    = (current_price - pos.avg_price) * pos.quantity;
    const pnl_pct       = pos.avg_price > 0 ? ((current_price - pos.avg_price) / pos.avg_price) * 100 : 0;
    stock_value        += current_price * pos.quantity;
    return {
      ...pos,
      current_price,
      pnl_amount: Math.round(pnl_amount),
      pnl_pct:    Math.round(pnl_pct * 100) / 100,
    };
  });

  const total_invested = rows.reduce((s, p) => s + p.avg_price * p.quantity, 0);
  const total_pnl      = stock_value - total_invested;
  const total_pnl_pct  = total_invested > 0 ? (total_pnl / total_invested) * 100 : 0;

  return NextResponse.json({
    cash:               Math.round(account.cash),
    stock_value:        Math.round(stock_value),
    total_value:        Math.round(account.cash + stock_value),
    total_pnl:          Math.round(total_pnl),
    total_pnl_pct:      Math.round(total_pnl_pct * 100) / 100,
    auto_trade_capital: account.auto_trade_capital ?? null,
    positions:          enriched,
  });
}

/** 계좌 설정 변경 (cash 직접 조정 / auto_trade_capital 설정) */
export async function PUT(req: NextRequest) {
  const [userId, body] = await Promise.all([getUserId(), req.json()]);
  if (!userId) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if ("cash" in body) {
    const cash = Number(body.cash);
    // 상한 10억 — 무제한 현금 설정은 모의투자 성과의 무결성을 깨뜨린다
    const CASH_MAX = 1_000_000_000;
    if (!isFinite(cash) || cash < 0 || cash > CASH_MAX) {
      return NextResponse.json(
        { error: `금액은 0원~${(CASH_MAX / 1e8).toFixed(0)}억원 범위여야 합니다.` },
        { status: 400 },
      );
    }
    updates.cash = Math.round(cash);
  }

  if ("auto_trade_capital" in body) {
    updates.auto_trade_capital = body.auto_trade_capital === null
      ? null
      : Math.max(1, Number(body.auto_trade_capital));
  }

  const { error } = await supabase.from("mock_accounts").update(updates).eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
