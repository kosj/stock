import { NextRequest, NextResponse } from "next/server";
import { getDartCompanyInfo } from "@/lib/server/dart";
import { marketTickerRequest } from "@/lib/server/market-request";

export const dynamic    = "force-dynamic";
export const maxDuration = 20;

type Ctx = { params: Promise<{ ticker: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { ticker } = await params;
  const input = await marketTickerRequest(ticker);
  if (!input.ok) return input.response;
  const t = input.ticker;
  if (!/^\d{6}$/.test(t)) return NextResponse.json({ error: "국내 종목코드가 필요합니다." }, { status: 400 });

  const { info, error } = await getDartCompanyInfo(t);

  if (!info) {
    // error 필드를 응답에 포함 → 클라이언트/진단에서 실패 원인 파악 가능
    return NextResponse.json({ available: false, reason: error ?? "알 수 없는 오류" }, { status: 200 });
  }
  return NextResponse.json({ available: true, ...info });
}
