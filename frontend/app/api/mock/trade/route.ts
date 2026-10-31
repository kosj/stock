import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/server/supabase";
import { requireUser } from "@/lib/server/require-user";
import { ExecutionMarketDataAdapter } from "@/lib/server/adapters/execution-market-data-adapter";
import { KrMarketClock } from "@/lib/server/adapters/kr-market-clock";
import { SupabaseExecutionControl } from "@/lib/server/adapters/supabase-execution-control";
import { effectivePrice } from "@/lib/core/execution-policy";
import { mockCosts } from "@/lib/server/mock-execution";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const ticker = req.nextUrl.searchParams.get("ticker") ?? "";
  const side = req.nextUrl.searchParams.get("side");
  if (!/^\d{6}$/.test(ticker) || (side !== "BUY" && side !== "SELL")) return NextResponse.json({ error: "국내 종목 필요" }, { status: 400 });
  const quote = await new ExecutionMarketDataAdapter(auth.userId).getQuote(ticker).catch(() => null);
  if (!quote?.price) return NextResponse.json({ error: "체결 가능한 최신 시세 없음" }, { status: 502 });
  return NextResponse.json({ price: quote.price, effective_price: effectivePrice(quote.price, side, mockCosts(ticker)) });
}
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null);
  const { ticker, name, trade_type, quantity, client_order_id, account_epoch } = body ?? {};
  if (typeof ticker !== "string" || !/^\d{6}$/.test(ticker) || typeof name !== "string" || !name.trim() || name.length > 100
    || !["BUY", "SELL"].includes(trade_type) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1_000_000
    || typeof client_order_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(client_order_id)
    || !Number.isSafeInteger(account_epoch) || account_epoch < 0)
    return NextResponse.json({ error: "국내 종목·정수 수량·주문 UUID·계좌 세대가 필요합니다." }, { status: 400 });
  const lock = new SupabaseExecutionControl();
  try {
    if (!await lock.acquire(auth.userId)) return NextResponse.json({ error: "다른 계좌 작업이 진행 중입니다." }, { status: 409 });
    try {
      // Reconcile before market checks: a lost success response can be retried after close.
      const { data: previous, error: lookupError } = await supabase.from("mock_trades")
        .select("ticker,trade_type,quantity,price,total_amount,execution_cost")
        .eq("user_id", auth.userId).eq("client_order_id", `${account_epoch}:${client_order_id}`).maybeSingle();
      if (lookupError) throw new Error(lookupError.message);
      if (previous) {
        if (previous.ticker !== ticker || previous.trade_type !== trade_type || previous.quantity !== quantity)
          return NextResponse.json({ error: "주문 키 충돌" }, { status: 409 });
        return NextResponse.json({ ok: true, duplicate: true, ...previous });
      }
      if (!new KrMarketClock().isMarketOpen()) return NextResponse.json({ error: "정규장 외에는 체결하지 않습니다." }, { status: 409 });
      const quote = await new ExecutionMarketDataAdapter(auth.userId).getQuote(ticker).catch(() => null);
      if (!quote?.price) return NextResponse.json({ error: "실제 거래시각이 확인된 최신 시세가 없습니다." }, { status: 502 });
      const { data, error } = await supabase.rpc("execute_mock_order", {
        p_user_id: auth.userId, p_ticker: ticker, p_name: name, p_quantity: quantity,
        p_price: effectivePrice(quote.price, trade_type, mockCosts(ticker)), p_client_order_id: client_order_id,
        p_side: trade_type, p_account_epoch: account_epoch, p_execution_owner: lock.owner, p_reference_price: quote.price,
      });
      if (error) throw new Error(error.message);
      return NextResponse.json(data);
    } finally { await lock.release(auth.userId); }
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "주문 실패" }, { status: 409 }); }
}
