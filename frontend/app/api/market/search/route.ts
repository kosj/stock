import { NextRequest, NextResponse } from "next/server";
import { searchStocks } from "@/lib/server/yahoo-finance";
import { createBrokerProvider } from "@/lib/server/providers";
import type { BrokerType } from "@/lib/server/providers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (!q.trim()) return NextResponse.json([]);

  const brokerType = req.headers.get("x-broker-type") as BrokerType | null;
  const appKey     = req.headers.get("x-app-key");
  const appSecret  = req.headers.get("x-app-secret");
  const hasBroker  = !!(brokerType && appKey && appSecret);
  const hasKorean  = /[가-힣]/.test(q);

  // 브로커 프로바이더 (재사용)
  let provider = hasBroker
    ? createBrokerProvider(brokerType!, { appKey: appKey!, appSecret: appSecret! })
    : null;

  // 한글 검색 + 브로커 있음 → KIS 우선 시도
  if (hasKorean && provider) {
    try {
      const results = await provider.searchStocks(q);
      if (results.length > 0) return NextResponse.json(results);
    } catch (err) {
      console.warn("[search] KIS Korean search failed, trying Yahoo:", err);
    }
  }

  // Yahoo Finance (한글 포함 직접 API 지원)
  const yahooResults = await searchStocks(q);
  if (yahooResults.length > 0) return NextResponse.json(yahooResults);

  // Yahoo도 빈 결과 + 브로커 → 브로커 폴백 (비한글/코드 검색용)
  if (provider && !hasKorean) {
    try {
      const results = await provider.searchStocks(q);
      if (results.length > 0) return NextResponse.json(results);
    } catch (err) {
      console.warn("[search] broker fallback failed:", err);
    }
  }

  return NextResponse.json([]);
}
