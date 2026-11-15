import { NextRequest, NextResponse } from "next/server";
import { searchStocks, searchStocksNaver } from "@/lib/server/yahoo-finance";
import { requireApprovedUser } from "@/lib/server/require-user";

export const dynamic     = "force-dynamic";
export const maxDuration = 20;

export async function GET(req: NextRequest) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return auth.response;
  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (q.length > 80 || /[\x00-\x1F\x7F]/.test(q)) return NextResponse.json({ error: "invalid search query" }, { status: 400 });
  if (!q.trim()) return NextResponse.json([]);

  // Broker keys are never accepted from request headers; saved keys live server-side only.
  const hasKorean  = /[가-힣]/.test(q);

  if (hasKorean) {
    // 1. 네이버 증권 자동완성 — Vercel IP 차단 없음
    const naverResults = await searchStocksNaver(q);
    if (naverResults.length > 0) return NextResponse.json(naverResults);

    // 2. Yahoo Finance 직접 API — Vercel에서 차단될 수 있으나 시도
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

  return NextResponse.json([]);
}
