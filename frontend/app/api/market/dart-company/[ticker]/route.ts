import { NextRequest, NextResponse } from "next/server";
import { getDartCompanyInfo } from "@/lib/server/dart";

export const dynamic    = "force-dynamic";
export const maxDuration = 20;

type Ctx = { params: Promise<{ ticker: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { ticker } = await params;
  const t = ticker.toUpperCase().replace(/[^0-9A-Z]/g, "");

  const { info, error } = await getDartCompanyInfo(t);

  if (!info) {
    // error 필드를 응답에 포함 → 클라이언트/진단에서 실패 원인 파악 가능
    return NextResponse.json({ available: false, reason: error ?? "알 수 없는 오류" }, { status: 200 });
  }
  return NextResponse.json({ available: true, ...info });
}
