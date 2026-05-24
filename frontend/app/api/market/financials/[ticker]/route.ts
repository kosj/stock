import { NextRequest, NextResponse } from "next/server";
import { getFinancials } from "@/lib/server/yahoo-finance";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ ticker: string }> };

export async function GET(_: NextRequest, { params }: Ctx) {
  const { ticker } = await params;
  const data = await getFinancials(ticker.toUpperCase());
  return NextResponse.json(data);
}
