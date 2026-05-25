import { NextRequest, NextResponse } from "next/server";
import { searchStocks, searchStocksNaver } from "@/lib/server/yahoo-finance";
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

  if (hasKorean) {
    // 1. KIS (브로커 설정 시) — 가장 정확
    if (provider) {
      try {
        const results = await provider.searchStocks(q);
        if (results.length > 0) return NextResponse.json(results);
      } catch (err) {
        console.warn("[search] KIS Korean search failed:", err);
      }
    }

    // 2. 네이버 증권 자동완성 — Vercel IP 차단 없음
    const naverResults = await searchStocksNaver(q);
    if (naverResults.length > 0) return NextResponse.json(naverResults);

    // 3. Yahoo Finance 직접 API — Vercel에서 차단될 수 있으나 시도
    const yahooResults = await searchStocks(q);
    if (yahooResults.length > 0) return NextResponse.json(yahooResults);

    return NextResponse.json([]);
  }

  // 영문/코드 검색 → Yahoo 우선, 브로커 폴백
  const yahooResults = await searchStocks(q);
  if (yahooResults.length > 0) return NextResponse.json(yahooResults);

  if (provider) {
    try {
      const results = await provider.searchStocks(q);
      if (results.length > 0) return NextResponse.json(results);
    } catch (err) {
      console.warn("[search] broker fallback failed:", err);
    }
  }

  return NextResponse.json([]);
}
