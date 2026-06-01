import { NextRequest, NextResponse } from "next/server";
import { searchStocks, searchStocksNaver } from "@/lib/server/yahoo-finance";
import { createBrokerProvider } from "@/lib/server/providers";
import type { BrokerType } from "@/lib/server/providers";

export const dynamic     = "force-dynamic";
export const maxDuration = 20;

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

  // 영문/숫자 검색 — Yahoo + 네이버 병렬 실행 (NC, SK, LG 같은 한국 기업 약칭 커버)
  const [yahooResults, naverResults] = await Promise.all([
    searchStocks(q),
    searchStocksNaver(q),
  ]);

  if (yahooResults.length > 0 || naverResults.length > 0) {
    // 한국 종목(네이버) 우선, Yahoo 결과를 뒤에 추가하되 중복 ticker 제거
    const seen = new Set<string>();
    const merged = [...naverResults, ...yahooResults].filter((r) => {
      if (seen.has(r.ticker)) return false;
      seen.add(r.ticker);
      return true;
    });
    return NextResponse.json(merged);
  }

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
