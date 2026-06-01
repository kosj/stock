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
  if (!ticker || !name || !["BUY", "SELL"].includes(trade_type) || !(quantity > 0)) {
    return NextResponse.json(
      { error: "ticker, name, trade_type(BUY|SELL), quantity 필요" },
      { status: 400 },
    );
  }

  // 현재가 조회 (체결가) — DB 조회와 독립적이므로 단독 실행
  const quote = await getQuote(ticker);
  if (!quote?.price || quote.price <= 0) {
    return NextResponse.json({ error: `${ticker} 시세를 조회할 수 없습니다.` }, { status: 502 });
  }

  const price = Math.round(quote.price * 100) / 100;

  // BUY / SELL 모두 RPC 1 왕복으로 처리 (기존 5~6 왕복 대비 대폭 단축)
  const rpcName = trade_type === "BUY" ? "execute_mock_buy" : "execute_mock_sell";
  const { data: result, error } = await supabase.rpc(rpcName, {
    p_user_id:  userId,
    p_ticker:   ticker,
    p_name:     name,
    p_quantity: quantity,
    p_price:    price,
  });

  if (error) {
    const msg = error.message;
    if (msg.includes("insufficient_cash")) {
      const [, cash, needed] = msg.split(":");
      return NextResponse.json({
        error: `잔금 부족: 보유 ${Math.round(Number(cash)).toLocaleString()}원, 필요 ${Math.round(Number(needed)).toLocaleString()}원`,
      }, { status: 400 });
    }
    if (msg.includes("insufficient_quantity")) {
      const [, has, wants] = msg.split(":");
      return NextResponse.json({
        error: `보유 수량 부족: 보유 ${has}주, 매도 요청 ${wants}주`,
      }, { status: 400 });
    }
    if (msg.includes("no_position")) {
      return NextResponse.json({ error: "보유하지 않은 종목입니다." }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json(result);
}
