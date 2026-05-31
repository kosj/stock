import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/server/supabase";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getQuote } from "@/lib/server/yahoo-finance";

export const dynamic    = "force-dynamic";
export const maxDuration = 15;

async function getUserId(): Promise<string | null> {
  const client = await createSupabaseServerClient();
  const { data: { user } } = await client.auth.getUser();
  return user?.id ?? null;
}

export async function POST(req: NextRequest) {
  const [userId, body] = await Promise.all([getUserId(), req.json()]);
  if (!userId) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { ticker, name, trade_type, quantity } = body ?? {};
  if (!ticker || !name || !["BUY", "SELL"].includes(trade_type) || !quantity || quantity <= 0) {
    return NextResponse.json({ error: "ticker, name, trade_type(BUY|SELL), quantity 필요" }, { status: 400 });
  }

  // 현재가 조회 (체결가)
  const quote = await getQuote(ticker);
  if (!quote?.price || quote.price <= 0) {
    return NextResponse.json({ error: `${ticker} 시세를 조회할 수 없습니다.` }, { status: 502 });
  }
  const price        = Math.round(quote.price * 100) / 100;
  const total_amount = Math.round(price * quantity);

  // 계좌 조회 — 없으면 자동 생성
  let { data: account } = await supabase
    .from("mock_accounts").select("*").eq("user_id", userId).single();
  if (!account) {
    const { data: created } = await supabase
      .from("mock_accounts").insert({ user_id: userId, cash: 10_000_000 }).select().single();
    account = created;
  }
  if (!account) return NextResponse.json({ error: "계좌 조회 실패" }, { status: 500 });

  if (trade_type === "BUY") {
    if (account.cash < total_amount) {
      return NextResponse.json({
        error: `잔금 부족: 보유 현금 ${Math.round(account.cash).toLocaleString()}원, 필요 금액 ${total_amount.toLocaleString()}원`,
      }, { status: 400 });
    }

    const new_cash = account.cash - total_amount;

    // 기존 포지션 조회 → 평균단가 재계산
    const { data: existing } = await supabase
      .from("mock_positions").select("*").eq("user_id", userId).eq("ticker", ticker).single();

    if (existing) {
      const new_qty   = existing.quantity + quantity;
      const new_avg   = ((existing.avg_price * existing.quantity) + total_amount) / new_qty;
      await supabase.from("mock_positions").update({
        quantity: new_qty,
        avg_price: Math.round(new_avg * 100) / 100,
        updated_at: new Date().toISOString(),
      }).eq("user_id", userId).eq("ticker", ticker);
    } else {
      await supabase.from("mock_positions").insert({
        user_id: userId, ticker, name,
        quantity, avg_price: price, updated_at: new Date().toISOString(),
      });
    }

    await supabase.from("mock_accounts").update({
      cash: new_cash, updated_at: new Date().toISOString(),
    }).eq("user_id", userId);

    await supabase.from("mock_trades").insert({
      user_id: userId, ticker, name, trade_type: "BUY", quantity, price, total_amount,
    });

    return NextResponse.json({ ok: true, price, total_amount, new_cash: Math.round(new_cash) });

  } else {
    // SELL
    const { data: existing } = await supabase
      .from("mock_positions").select("*").eq("user_id", userId).eq("ticker", ticker).single();

    if (!existing || existing.quantity < quantity) {
      return NextResponse.json({
        error: `보유 수량 부족: 보유 ${existing?.quantity ?? 0}주, 매도 요청 ${quantity}주`,
      }, { status: 400 });
    }

    const new_qty  = existing.quantity - quantity;
    const new_cash = account.cash + total_amount;

    if (new_qty === 0) {
      await supabase.from("mock_positions").delete().eq("user_id", userId).eq("ticker", ticker);
    } else {
      await supabase.from("mock_positions").update({
        quantity: new_qty, updated_at: new Date().toISOString(),
      }).eq("user_id", userId).eq("ticker", ticker);
    }

    await supabase.from("mock_accounts").update({
      cash: new_cash, updated_at: new Date().toISOString(),
    }).eq("user_id", userId);

    await supabase.from("mock_trades").insert({
      user_id: userId, ticker, name, trade_type: "SELL", quantity, price, total_amount,
    });

    return NextResponse.json({ ok: true, price, total_amount, new_cash: Math.round(new_cash) });
  }
}
