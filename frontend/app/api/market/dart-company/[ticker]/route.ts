import { NextRequest, NextResponse } from "next/server";
import { getDartCompanyInfo } from "@/lib/server/dart";

export const dynamic    = "force-dynamic";
export const maxDuration = 15;

type Ctx = { params: Promise<{ ticker: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { ticker } = await params;
  const t = ticker.toUpperCase().replace(/[^0-9A-Z]/g, "");

  const info = await getDartCompanyInfo(t);
  if (!info) {
    return NextResponse.json({ available: false }, { status: 200 });
  }
  return NextResponse.json({ available: true, ...info });
}
