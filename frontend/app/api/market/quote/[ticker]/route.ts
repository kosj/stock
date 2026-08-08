import { NextRequest, NextResponse } from "next/server";
import { getQuote } from "@/lib/server/yahoo-finance";
import { createBrokerProvider } from "@/lib/server/providers";
import type { BrokerType } from "@/lib/server/providers";

export const dynamic     = "force-dynamic";
export const maxDuration = 30;

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

  // Yahoo Finance (nocache=1 쿼리 파라미터 시 캐시 우회 — 수동 새로고침용)
  const nocache = req.nextUrl.searchParams.get("nocache") === "1";
  const data = await getQuote(t, nocache);
  if (!data) return NextResponse.json({ error: "시세 조회 실패" }, { status: 404 });
  // 실제 출처를 보존 — 네이버 폴백 응답까지 "yahoo"로 강제 라벨링하던 오기 수정.
  // getQuote가 source를 안 주는 구버전 응답만 yahoo로 간주. as_of로 기준시각 노출.
  const source = (data as { source?: string }).source ?? "yahoo";
  return NextResponse.json({ ...data, source, as_of: data.timestamp ?? new Date().toISOString() });
}
