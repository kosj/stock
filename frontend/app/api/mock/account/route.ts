import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/server/supabase";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getQuote } from "@/lib/server/yahoo-finance";

export const dynamic    = "force-dynamic";
export const maxDuration = 20;

const INITIAL_CASH = 10_000_000; // 1000만원

async function getUserId(): Promise<string | null> {
  const client = await createSupabaseServerClient();
  const { data: { user } } = await client.auth.getUser();
  return user?.id ?? null;
}

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  // 계좌 조회 — 없으면 자동 생성
  let { data: account } = await supabase
    .from("mock_accounts")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (!account) {
    const { data: created } = await supabase
      .from("mock_accounts")
      .insert({ user_id: userId, cash: INITIAL_CASH })
      .select()
      .single();
    account = created;
  }

  if (!account) return NextResponse.json({ error: "계좌 생성 실패" }, { status: 500 });

  // 보유 포지션 조회
  const { data: positions } = await supabase
    .from("mock_positions")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  const rows = positions ?? [];

  // 현재가 병렬 조회
  const quotes = await Promise.allSettled(
    rows.map((p) => getQuote(p.ticker)),
  );

  let stock_value = 0;
  const enriched = rows.map((pos, i) => {
    const q = quotes[i].status === "fulfilled" ? quotes[i].value : null;
    const current_price = q?.price ?? pos.avg_price;
    const pnl_amount    = (current_price - pos.avg_price) * pos.quantity;
    const pnl_pct       = ((current_price - pos.avg_price) / pos.avg_price) * 100;
    stock_value += current_price * pos.quantity;
    return { ...pos, current_price, pnl_amount: Math.round(pnl_amount), pnl_pct: Math.round(pnl_pct * 100) / 100 };
  });

  const total_value   = account.cash + stock_value;
  const total_invested = rows.reduce((s, p) => s + p.avg_price * p.quantity, 0);
  const total_pnl      = stock_value - total_invested;
  const total_pnl_pct  = total_invested > 0 ? (total_pnl / total_invested) * 100 : 0;

  return NextResponse.json({
    cash:                Math.round(account.cash),
    stock_value:         Math.round(stock_value),
    total_value:         Math.round(total_value),
    total_pnl:           Math.round(total_pnl),
    total_pnl_pct:       Math.round(total_pnl_pct * 100) / 100,
    auto_trade_capital:  account.auto_trade_capital ?? null,
    positions:           enriched,
  });
}

/** 계좌 설정 변경 (cash 직접 조정 / auto_trade_capital 설정) */
export async function PUT(req: NextRequest) {
  const [userId, body] = await Promise.all([getUserId(), req.json()]);
  if (!userId) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if ("cash" in body) {
    const cash = Number(body.cash);
    if (isNaN(cash) || cash < 0) {
      return NextResponse.json({ error: "올바른 금액을 입력해주세요." }, { status: 400 });
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
