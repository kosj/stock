import { NextRequest, NextResponse } from "next/server";
import { getFinancials } from "@/lib/server/yahoo-finance";

export const maxDuration = 30;
export const revalidate  = 3600; // 1시간 — 재무지표는 분기마다 갱신. force-dynamic 제거해야 revalidate 작동

type Ctx = { params: Promise<{ ticker: string }> };

export async function GET(_: NextRequest, { params }: Ctx) {
  const { ticker } = await params;
  const data = await getFinancials(ticker.toUpperCase());
  return NextResponse.json(data);
}
