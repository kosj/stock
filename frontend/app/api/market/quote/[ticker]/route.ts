import { NextRequest, NextResponse } from "next/server";
import { getQuote } from "@/lib/server/yahoo-finance";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ ticker: string }> };

export async function GET(_: NextRequest, { params }: Ctx) {
  const { ticker } = await params;
  const data = await getQuote(ticker.toUpperCase());
  if (!data) return NextResponse.json({ error: "시세 조회 실패" }, { status: 404 });
  return NextResponse.json(data);
}
