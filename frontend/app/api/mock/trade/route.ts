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

  const { ticker, name, trade_type, quantity, client_order_id } = body ?? {};
  if (!ticker || !name || !["BUY", "SELL"].includes(trade_type) || !(quantity > 0)) {
    return NextResponse.json(
      { error: "ticker, name, trade_type(BUY|SELL), quantity 필요" },
      { status: 400 },
    );
  }
  // 정수 수량 강제 — INTEGER 컬럼 절삭/오류로 이어지는 소수 수량 사전 차단
  if (!Number.isInteger(quantity)) {
    return NextResponse.json({ error: "quantity는 정수(주 단위)여야 합니다." }, { status: 400 });
  }

  // 현재가 조회 (체결가) — DB 조회와 독립적이므로 단독 실행
  const quote = await getQuote(ticker);
  if (!quote?.price || quote.price <= 0) {
    return NextResponse.json({ error: `${ticker} 시세를 조회할 수 없습니다.` }, { status: 502 });
  }

  // ── 거래 비용 모델: 실효 체결가에 반영 (RPC 스키마 변경 불필요) ──────────
  // 매수: 위탁수수료 0.015% 가산 / 매도: 수수료 0.015% + 증권거래세 0.18% 차감.
  // 비용을 체결가에 녹이면 평단(매수)과 회수금(매도)에 자동 반영된다 —
  // 기존 0원 비용은 회전 잦은 전략의 수익률을 구조적으로 과대평가했다.
  const FEE_RATE = 0.00015;
  const TAX_RATE = 0.0018;
  const costMult = trade_type === "BUY" ? 1 + FEE_RATE : 1 - FEE_RATE - TAX_RATE;
  const rawPrice = Math.round(quote.price * 100) / 100;
  const price    = Math.round(quote.price * costMult * 100) / 100;

  // BUY / SELL 모두 RPC 1 왕복으로 처리 (기존 5~6 왕복 대비 대폭 단축)
  const rpcName = trade_type === "BUY" ? "execute_mock_buy" : "execute_mock_sell";
  const { data: result, error } = await supabase.rpc(rpcName, {
    p_user_id:  userId,
    p_ticker:   ticker,
    p_name:     name,
    p_quantity: quantity,
    p_price:    price,
    // 클라이언트가 주문 UUID를 보내면 더블클릭/재시도 중복 체결이 DB에서 차단된다
    p_client_order_id: typeof client_order_id === "string" && client_order_id ? client_order_id : null,
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
