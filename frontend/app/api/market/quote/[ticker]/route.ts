import { NextRequest, NextResponse } from "next/server";
import { getQuote } from "@/lib/server/yahoo-finance";
import { createBrokerProvider } from "@/lib/server/providers";
import type { BrokerType } from "@/lib/server/providers";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ ticker: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const { ticker } = await params;
  const t = ticker.toUpperCase();

  // 요청 헤더에 증권사 자격증명이 있으면 broker API 우선 사용
  const brokerType = req.headers.get("x-broker-type") as BrokerType | null;
  const appKey    = req.headers.get("x-app-key");
  const appSecret = req.headers.get("x-app-secret");

  if (brokerType && appKey && appSecret) {
    try {
      const provider = createBrokerProvider(brokerType, { appKey, appSecret });
      const q = await provider.getQuote(t);
      // StockQuoteResponse → QuoteData 형식으로 정규화
      return NextResponse.json({
        ticker:     t,
        name:       q.name,
        price:      q.price,
        change:     q.change,
        change_pct: q.change_rate,
        volume:     q.volume,
        high:       q.high,
        low:        q.low,
        open:       q.open,
        prev_close: q.prev_close,
        timestamp:  q.timestamp,
        source:     brokerType,
      });
    } catch (err) {
      console.warn(`[quote] broker(${brokerType}) 실패, Yahoo 폴백:`, err);
      // 실패 시 Yahoo Finance로 폴백
    }
  }

  // Yahoo Finance
  const data = await getQuote(t);
  if (!data) return NextResponse.json({ error: "시세 조회 실패" }, { status: 404 });
  return NextResponse.json({ ...data, source: "yahoo" });
}
