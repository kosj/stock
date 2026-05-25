import { NextRequest, NextResponse } from "next/server";
import { searchStocks } from "@/lib/server/yahoo-finance";
import { createBrokerProvider } from "@/lib/server/providers";
import type { BrokerType } from "@/lib/server/providers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (!q.trim()) return NextResponse.json([]);

  // Yahoo Finance 검색 우선
  const results = await searchStocks(q);
  if (results.length > 0) return NextResponse.json(results);

  // 야후 결과 없음 → 브로커 폴백
  const brokerType = req.headers.get("x-broker-type") as BrokerType | null;
  const appKey     = req.headers.get("x-app-key");
  const appSecret  = req.headers.get("x-app-secret");

  if (brokerType && appKey && appSecret) {
    try {
      const provider = createBrokerProvider(brokerType, { appKey, appSecret });
      const brokerResults = await provider.searchStocks(q);
      if (brokerResults.length > 0) return NextResponse.json(brokerResults);
    } catch (err) {
      console.warn(`[search] broker(${brokerType}) 폴백 실패:`, err);
    }
  }

  return NextResponse.json([]);
}
