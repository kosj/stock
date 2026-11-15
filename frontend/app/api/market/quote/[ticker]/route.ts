import { NextRequest, NextResponse } from "next/server";
import { getQuote } from "@/lib/server/yahoo-finance";
import { marketTickerRequest } from "@/lib/server/market-request";

export const dynamic     = "force-dynamic";
export const maxDuration = 30;

type Ctx = { params: Promise<{ ticker: string }> };

// Broker keys are never accepted from request headers; saved keys live server-side only.
export async function GET(req: NextRequest, { params }: Ctx) {
  const { ticker } = await params;
  const input = await marketTickerRequest(ticker);
  if (!input.ok) return input.response;
  const t = input.ticker;

  // Yahoo Finance (nocache=1 쿼리 파라미터 시 캐시 우회 — 수동 새로고침용)
  const nocache = req.nextUrl.searchParams.get("nocache") === "1";
  const data = await getQuote(t, nocache);
  if (!data) return NextResponse.json({ error: "시세 조회 실패" }, { status: 404 });
  // 실제 출처를 보존 — 네이버 폴백 응답까지 "yahoo"로 강제 라벨링하던 오기 수정.
  // getQuote가 source를 안 주는 구버전 응답만 yahoo로 간주. as_of로 기준시각 노출.
  const source = (data as { source?: string }).source ?? "yahoo";
  return NextResponse.json({ ...data, source, as_of: data.timestamp ?? new Date().toISOString() });
}
